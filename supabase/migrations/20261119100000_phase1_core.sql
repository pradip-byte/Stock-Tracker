-- Phase 1: core schema. All tables have RLS on. Reads are allowed only for a
-- signed-in user whose email is in allowed_users. All writes go through the
-- service role (server routes, cron jobs, local scripts), which bypasses RLS.

-- ───────────── access control ─────────────
create table if not exists public.allowed_users (
  email text primary key,
  added_at timestamptz not null default now()
);
alter table public.allowed_users enable row level security;
-- no policies: only the service role can read or write this table

create or replace function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.allowed_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_allowed() from public;
grant execute on function public.is_allowed() to authenticated;

-- ───────────── stocks ─────────────
create table if not exists public.stocks (
  symbol text primary key,                 -- NSE symbol, e.g. RELIANCE. Indices use NIFTY50 / INDIAVIX
  name text not null,
  kind text not null default 'equity' check (kind in ('equity', 'index')),
  sector text,
  provider_symbol text not null,           -- e.g. RELIANCE.NS, ^NSEI
  source text not null default 'user' check (source in ('nifty200', 'user', 'system')),
  in_watchlist boolean not null default false,
  backfill_status text not null default 'pending'
    check (backfill_status in ('pending', 'running', 'done', 'error')),
  backfill_error text,
  first_candle date,
  last_candle date,
  last_eod_run date,
  added_at timestamptz not null default now()
);

-- ───────────── prices ─────────────
create table if not exists public.candles_daily (
  symbol text not null references public.stocks(symbol) on delete cascade,
  date date not null,
  open numeric(14,4) not null,
  high numeric(14,4) not null,
  low numeric(14,4) not null,
  close numeric(14,4) not null,
  volume bigint not null default 0,
  primary key (symbol, date)
);

create table if not exists public.quotes_latest (
  symbol text primary key references public.stocks(symbol) on delete cascade,
  price numeric(14,4) not null,
  prev_close numeric(14,4),
  day_high numeric(14,4),
  day_low numeric(14,4),
  volume bigint,
  market_time timestamptz,                 -- exchange timestamp of the quote
  fetched_at timestamptz not null default now()
);

-- ───────────── indicators and scores ─────────────
create table if not exists public.indicators_daily (
  symbol text not null references public.stocks(symbol) on delete cascade,
  date date not null,
  close numeric(14,4) not null,
  rsi14 numeric(7,3),
  macd numeric(14,4),
  macd_signal numeric(14,4),
  macd_hist numeric(14,4),
  sma20 numeric(14,4),
  sma50 numeric(14,4),
  sma200 numeric(14,4),
  atr14 numeric(14,4),
  vol_ratio20 numeric(9,3),
  hi52 numeric(14,4),
  lo52 numeric(14,4),
  dist_hi52_pct numeric(9,3),
  dist_lo52_pct numeric(9,3),
  support numeric(14,4)[] not null default '{}',
  resistance numeric(14,4)[] not null default '{}',
  sig_bounce boolean not null default false,
  sig_trend boolean not null default false,
  sig_breakdown boolean not null default false,
  spark numeric(14,4)[] not null default '{}',   -- last 30 closes, for table sparklines
  computed_at timestamptz not null default now(),
  primary key (symbol, date)
);

create table if not exists public.scores (
  symbol text not null references public.stocks(symbol) on delete cascade,
  date date not null,
  technical smallint,
  technical_reasons jsonb not null default '[]',
  event smallint,
  event_reasons jsonb not null default '[]',
  external smallint,
  overall smallint,
  short_verdict text check (short_verdict in ('Favourable', 'Neutral', 'Avoid')),
  long_verdict text check (long_verdict in ('Favourable', 'Neutral', 'Avoid')),
  risk text check (risk in ('Low', 'Medium', 'High')),
  target numeric(14,4),
  stop numeric(14,4),
  reward_risk numeric(7,2),
  verdict_reasons jsonb not null default '{}',
  computed_at timestamptz not null default now(),
  primary key (symbol, date)
);

-- ───────────── later phases (created now so the schema is stable) ─────────────
create table if not exists public.earnings (
  symbol text not null references public.stocks(symbol) on delete cascade,
  period_end date not null,
  fiscal_label text,
  result_date date,
  revenue numeric(18,2),
  net_profit numeric(18,2),
  eps numeric(12,4),
  source text,
  fetched_at timestamptz not null default now(),
  primary key (symbol, period_end)
);

create table if not exists public.external_signals (
  id bigint generated always as identity primary key,
  symbol text not null references public.stocks(symbol) on delete cascade,
  run_at timestamptz not null default now(),
  model text,
  sentiment smallint,
  confidence smallint,
  score smallint,
  payload jsonb not null default '{}',
  sources jsonb not null default '[]'
);
create index if not exists external_signals_symbol_run on public.external_signals (symbol, run_at desc);

create table if not exists public.signal_backtests (
  scope text not null check (scope in ('stock', 'sector', 'all')),
  scope_key text not null,
  signal text not null,
  horizon_days smallint not null,
  samples integer not null,
  hit_rate numeric(6,3),
  avg_return numeric(8,3),
  computed_at timestamptz not null default now(),
  primary key (scope, scope_key, signal, horizon_days)
);

create table if not exists public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  status text not null check (status in ('running', 'ok', 'partial', 'error', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok_count integer not null default 0,
  fail_count integer not null default 0,
  detail jsonb not null default '{}',
  error text
);
create index if not exists job_runs_started on public.job_runs (started_at desc);

-- ───────────── RLS: read-only for the allowed user ─────────────
do $$
declare t text;
begin
  foreach t in array array[
    'stocks', 'candles_daily', 'quotes_latest', 'indicators_daily', 'scores',
    'earnings', 'external_signals', 'signal_backtests', 'job_runs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_allowed())',
      t || '_read', t
    );
  end loop;
end $$;

-- ───────────── one row per stock with everything the lists need ─────────────
create or replace view public.stock_latest
with (security_invoker = true) as
select
  s.symbol, s.name, s.kind, s.sector, s.source, s.in_watchlist,
  s.backfill_status, s.backfill_error, s.first_candle, s.last_candle, s.added_at,
  q.price, q.prev_close, q.day_high, q.day_low, q.market_time, q.fetched_at as quote_fetched_at,
  i.date as ind_date, i.close as ind_close, i.rsi14, i.macd_hist, i.sma20, i.sma50, i.sma200,
  i.atr14, i.vol_ratio20, i.hi52, i.lo52, i.dist_hi52_pct, i.dist_lo52_pct,
  i.support, i.resistance, i.sig_bounce, i.sig_trend, i.sig_breakdown, i.spark,
  sc.technical, sc.technical_reasons, sc.event, sc.external, sc.overall,
  sc.short_verdict, sc.long_verdict, sc.risk, sc.target, sc.stop, sc.reward_risk
from public.stocks s
left join public.quotes_latest q on q.symbol = s.symbol
left join lateral (
  select * from public.indicators_daily d
  where d.symbol = s.symbol order by d.date desc limit 1
) i on true
left join lateral (
  select * from public.scores c
  where c.symbol = s.symbol order by c.date desc limit 1
) sc on true;

grant select on public.stock_latest to authenticated;
