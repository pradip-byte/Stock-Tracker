-- Phase 5C: paper trading. No real orders are ever placed.
--
-- book     'mine' = trades the user opened, 'shadow' = opened automatically for every qualifying signal
-- horizon  'ST' closes at target, stop or after max_sessions; 'LT' stays open until closed
-- A trade is created as 'pending' and filled at the first quote stamped AFTER the request
-- (the day's open if the request came while the market was closed), never at an earlier price.

alter table public.quotes_latest
  add column if not exists day_open numeric(14,4);

create table if not exists public.paper_trades (
  id bigint generated always as identity primary key,
  book text not null check (book in ('mine', 'shadow')),
  horizon text not null check (horizon in ('ST', 'LT')),
  symbol text not null,
  status text not null default 'pending' check (status in ('pending', 'open', 'closing', 'closed', 'cancelled')),
  amount numeric(14,2) not null check (amount > 0),
  requested_at timestamptz not null default now(),
  fill_rule text not null check (fill_rule in ('quote', 'open')),
  entry_at timestamptz,
  entry_price numeric(14,4),
  qty numeric(20,6),
  nifty_entry numeric(14,4),
  target numeric(14,4),
  stop numeric(14,4),
  max_sessions int,
  close_requested_at timestamptz,
  close_rule text check (close_rule in ('quote', 'open')),
  close_reason text,
  exit_at timestamptz,
  exit_price numeric(14,4),
  exit_reason text,
  nifty_exit numeric(14,4),
  cost_pct numeric(6,3) not null,         -- round-trip cost in percent; half is charged on entry, half on exit
  pnl_inr numeric(14,2),
  pnl_pct numeric(9,3),
  flag text,                              -- for example "Long-term verdict is now Avoid"
  context jsonb not null default '{}'     -- verdicts, entry rating, signals, scores and regime at the time of the request
);

create index if not exists paper_trades_status_idx on public.paper_trades (status);
create index if not exists paper_trades_book_idx on public.paper_trades (book, horizon, symbol);

alter table public.paper_trades enable row level security;
drop policy if exists paper_trades_read on public.paper_trades;
create policy paper_trades_read on public.paper_trades for select to authenticated using (public.is_allowed());
