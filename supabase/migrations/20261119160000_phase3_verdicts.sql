-- Phase 3 groundwork plus two Phase 2 refinements.

alter table public.fundamentals
  -- month (1-12) the company's financial year ends in; 3 for most Indian companies, 12 for calendar-year ones
  add column if not exists fiscal_year_end_month smallint,
  -- Filled by the Phase 4 AI job: a result date confirmed by a company or exchange announcement.
  -- While it is still in the future it takes precedence over the provider's estimate.
  add column if not exists confirmed_result_date date,
  add column if not exists confirmed_result_url text,
  add column if not exists confirmed_result_at timestamptz;

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
  f.event_score as event, f.event_reasons,
  case when cr.ok then f.confirmed_result_date else f.next_result_date end as next_result_date,
  case when cr.ok then false else f.next_result_is_estimate end as next_result_is_estimate,
  case when cr.ok then 'Announcement' else f.next_result_source end as next_result_source,
  case when cr.ok then f.confirmed_result_url end as next_result_url,
  f.pe, f.roe, f.debt_to_equity, f.profit_margin, f.fiscal_year_end_month,
  f.fetched_at as fundamentals_at, f.error as fundamentals_error
from public.stocks s
left join public.quotes_latest q on q.symbol = s.symbol
left join public.fundamentals f on f.symbol = s.symbol
left join lateral (
  select coalesce(f.confirmed_result_date >= (now() at time zone 'Asia/Kolkata')::date, false) as ok
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
