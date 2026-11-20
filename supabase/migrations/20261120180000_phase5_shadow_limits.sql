-- Shadow limit orders: a second shadow trade for "Wait for pullback" stocks, resting at the
-- suggested price for a set number of sessions. An order that is never reached becomes 'expired'.

alter table public.paper_trades
  add column if not exists variant text not null default 'market' check (variant in ('market', 'limit')),
  add column if not exists limit_price numeric(14,4),
  add column if not exists limit_sessions int;

alter table public.paper_trades drop constraint if exists paper_trades_status_check;
alter table public.paper_trades add constraint paper_trades_status_check
  check (status in ('pending', 'open', 'closing', 'closed', 'cancelled', 'expired'));

alter table public.paper_trades drop constraint if exists paper_trades_fill_rule_check;
alter table public.paper_trades add constraint paper_trades_fill_rule_check
  check (fill_rule in ('quote', 'open', 'limit'));
