-- News tone: each stored headline gets +1, 0 or -1 from keyword rules (no AI).
-- news_tone counts them per stock over the last 30 days. Tone is shown and recorded
-- on paper trades; it is not part of any verdict.

alter table public.news_items
  add column if not exists tone smallint not null default 0 check (tone in (-1, 0, 1));

create or replace view public.news_tone
with (security_invoker = true) as
select
  symbol,
  count(*) filter (where tone > 0)::int as positive,
  count(*) filter (where tone < 0)::int as negative,
  count(*)::int as total
from public.news_items
where symbol <> '_MARKET' and published_at > now() - interval '30 days'
group by symbol;

grant select on public.news_tone to authenticated;
