-- Phase 5D: macro view.
--   macro_series  daily closes of series that are not tracked as stocks (Brent, USD/INR, S&P 500, US 10-year yield)
--   macro_daily   one row per session: the numbers, breadth from our own stocks, and the regime label with its inputs
--   macro_notes   the weekly AI macro note
--   macro_events  each event from a note, with the measured Nifty and sector moves that followed

create table if not exists public.macro_series (
  series text not null,
  date date not null,
  close numeric(16,4) not null,
  primary key (series, date)
);

create table if not exists public.macro_daily (
  date date primary key,
  nifty numeric(14,4),
  nifty_sma200 numeric(14,4),
  vix numeric(10,4),
  vix_sma20 numeric(10,4),
  brent numeric(12,4),
  usdinr numeric(12,4),
  spx numeric(14,4),
  us10y numeric(8,4),
  breadth50 numeric(5,1),     -- % of tracked stocks above their 50 DMA
  breadth200 numeric(5,1),    -- % of tracked stocks above their 200 DMA
  breadth_count int,
  regime text check (regime in ('Risk-on', 'Neutral', 'Risk-off')),
  regime_score int,
  inputs jsonb not null default '[]',
  computed_at timestamptz not null default now()
);

create table if not exists public.macro_notes (
  id bigint generated always as identity primary key,
  run_at timestamptz not null default now(),
  model text,
  summary text,
  flows jsonb,
  sources jsonb not null default '[]',
  low_grade_sources boolean not null default false,
  ai_run_id bigint
);

create table if not exists public.macro_events (
  id bigint generated always as identity primary key,
  note_id bigint not null references public.macro_notes(id) on delete cascade,
  event_date date not null,
  title text not null,
  category text not null,
  summary text,
  url text not null,
  published date not null,
  helped jsonb not null default '[]',   -- [{ sector, why }]
  hurt jsonb not null default '[]',
  nifty_1d numeric(8,3),
  nifty_5d numeric(8,3),
  nifty_20d numeric(8,3),
  sector_moves jsonb not null default '{}',  -- { sector: { d1, d5, d20, stocks } }
  moves_at timestamptz
);
create index if not exists macro_events_date_idx on public.macro_events (event_date desc);

alter table public.ai_runs drop constraint if exists ai_runs_kind_check;
alter table public.ai_runs add constraint ai_runs_kind_check check (kind in ('sector', 'stock', 'macro'));

do $$
declare t text;
begin
  foreach t in array array['macro_series', 'macro_daily', 'macro_notes', 'macro_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_allowed())', t || '_read', t);
  end loop;
end $$;
