-- Phase 2: result dates, quarterly results, ratios and the event score.

create table if not exists public.fundamentals (
  symbol text primary key references public.stocks(symbol) on delete cascade,
  next_result_date date,                       -- null = unknown (never guessed)
  next_result_is_estimate boolean not null default false,
  next_result_source text,
  pe numeric(12,3),
  roe numeric(9,3),                            -- percent
  debt_to_equity numeric(12,3),                -- ratio (x)
  profit_margin numeric(9,3),                  -- percent, trailing
  event_score smallint,                        -- null = not enough data
  event_reasons jsonb not null default '[]',
  error text,
  fetched_at timestamptz not null default now()
);

alter table public.fundamentals enable row level security;
drop policy if exists fundamentals_read on public.fundamentals;
create policy fundamentals_read on public.fundamentals
  for select to authenticated using (public.is_allowed());

alter table public.earnings
  add column if not exists reported_at timestamptz,   -- when the result was announced
  add column if not exists eps_estimate numeric(12,4),
  add column if not exists reaction_1d numeric(8,3),  -- % move on the first session after the result
  add column if not exists reaction_5d numeric(8,3);  -- % move over the first five sessions

drop view if exists public.stock_latest;
create view public.stock_latest
with (security_invoker = true) as
select
  s.symbol, s.name, s.kind, s.sector, s.source, s.in_watchlist,
  s.backfill_status, s.backfill_error, s.first_candle, s.last_candle, s.added_at,
  q.price, q.prev_close, q.day_high, q.day_low, q.market_time, q.fetched_at as quote_fetched_at,
  i.date as ind_date, i.close as ind_close, i.rsi14, i.macd_hist, i.sma20, i.sma50, i.sma200,
  i.atr14, i.vol_ratio20, i.hi52, i.lo52, i.dist_hi52_pct, i.dist_lo52_pct,
  i.support, i.resistance, i.sig_bounce, i.sig_trend, i.sig_breakdown, i.spark,
  sc.technical, sc.technical_reasons, sc.external, sc.overall,
  sc.short_verdict, sc.long_verdict, sc.risk, sc.target, sc.stop, sc.reward_risk,
  f.event_score as event, f.event_reasons, f.next_result_date, f.next_result_is_estimate,
  f.next_result_source, f.pe, f.roe, f.debt_to_equity, f.profit_margin,
  f.fetched_at as fundamentals_at, f.error as fundamentals_error
from public.stocks s
left join public.quotes_latest q on q.symbol = s.symbol
left join public.fundamentals f on f.symbol = s.symbol
left join lateral (
  select * from public.indicators_daily d
  where d.symbol = s.symbol order by d.date desc limit 1
) i on true
left join lateral (
  select * from public.scores c
  where c.symbol = s.symbol order by c.date desc limit 1
) sc on true;

grant select on public.stock_latest to authenticated;
