-- Phase 6: free news feeds replace the paid AI jobs.
--
-- news_items    headline, source, time and link only. Article text is never stored.
--               symbol is a stock symbol, or '_MARKET' for market-wide headlines.
-- news_state    per stock: when its news was last fetched and when the user last opened its page
-- macro_flows   daily FII/DII net figures, only when a headline states them

create table if not exists public.news_items (
  id bigint generated always as identity primary key,
  symbol text not null,
  title text not null,
  title_key text not null,              -- normalised headline, for de-duplication
  source text,
  url text not null,
  published_at timestamptz not null,
  tags text[] not null default '{}',
  fetched_at timestamptz not null default now(),
  unique (symbol, title_key)
);
create index if not exists news_items_symbol_time_idx on public.news_items (symbol, published_at desc);
create index if not exists news_items_published_idx on public.news_items (published_at);

create table if not exists public.news_state (
  symbol text primary key,
  fetched_at timestamptz,
  seen_at timestamptz,
  last_error text
);

create table if not exists public.macro_flows (
  date date primary key,
  fii_net numeric(14,2),                -- rupees crore; negative is net selling
  dii_net numeric(14,2),
  title text not null,
  source text,
  url text not null,
  captured_at timestamptz not null default now()
);

-- headlines that are new since the stock's page was last opened (or in the last two days if never opened)
create or replace view public.news_new_counts
with (security_invoker = true) as
select n.symbol, count(*)::int as new_count
from public.news_items n
left join public.news_state s on s.symbol = n.symbol
where n.symbol <> '_MARKET'
  and n.published_at > now() - interval '7 days'
  and n.fetched_at > coalesce(s.seen_at, now() - interval '2 days')
group by n.symbol;

-- a result or board-meeting date stated in a headline
alter table public.fundamentals
  add column if not exists headline_result_date date,
  add column if not exists headline_result_url text,
  add column if not exists headline_result_title text,
  add column if not exists headline_result_at timestamptz;

-- events can now come from feed headlines as well as the AI note
alter table public.macro_events alter column note_id drop not null;
alter table public.macro_events
  add column if not exists origin text not null default 'ai' check (origin in ('ai', 'feed')),
  add column if not exists source text,
  add column if not exists exposed jsonb not null default '[]';   -- sectors usually sensitive to this kind of event, no direction implied
create unique index if not exists macro_events_feed_day_idx on public.macro_events (event_date, category) where origin = 'feed';

do $$
declare t text;
begin
  foreach t in array array['news_items', 'news_state', 'macro_flows'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_allowed())', t || '_read', t);
  end loop;
end $$;
grant select on public.news_new_counts to authenticated;

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
  sc.short_verdict, sc.long_verdict, sc.risk, sc.target, sc.stop, sc.reward_risk, sc.verdict_reasons,
  sc.mom12, sc.mom_rank, sc.rs6, sc.market_up, sc.entry,
  f.event_score as event, f.event_reasons,
  -- result date precedence: a confirmed announcement, then a date stated in a news headline, then the provider's estimate
  case when cr.ok then f.confirmed_result_date when cr.head then f.headline_result_date else f.next_result_date end as next_result_date,
  case when cr.ok or cr.head then false else f.next_result_is_estimate end as next_result_is_estimate,
  case when cr.ok then 'Announcement' when cr.head then 'From headline' else f.next_result_source end as next_result_source,
  case when cr.ok then f.confirmed_result_url when cr.head then f.headline_result_url end as next_result_url,
  case when cr.head and not cr.ok then f.headline_result_title end as next_result_headline,
  f.pe, f.roe, f.debt_to_equity, f.profit_margin, f.fiscal_year_end_month, f.industry,
  f.fetched_at as fundamentals_at, f.error as fundamentals_error
from public.stocks s
left join public.quotes_latest q on q.symbol = s.symbol
left join public.fundamentals f on f.symbol = s.symbol
left join lateral (
  select
    coalesce(f.confirmed_result_date >= (now() at time zone 'Asia/Kolkata')::date, false) as ok,
    coalesce(f.headline_result_date >= (now() at time zone 'Asia/Kolkata')::date, false) as head
) cr on true
left join lateral (
  select * from public.indicators_daily d
  where d.symbol = s.symbol order by d.date desc limit 1
) i on true
left join lateral (
  select * from public.scores c
  where c.symbol = s.symbol order by c.date desc limit 1
) sc on true;

grant select on public.stock_latest to authenticated;
