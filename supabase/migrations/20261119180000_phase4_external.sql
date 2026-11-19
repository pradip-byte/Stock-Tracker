-- Phase 4: external signals from Claude with web search, and a cost log.

-- One research note per sector per week, reused by every stock in that sector.
create table if not exists public.sector_research (
  id bigint generated always as identity primary key,
  sector text not null,
  run_at timestamptz not null default now(),
  model text,
  outlook_score smallint,                 -- -2..+2
  payload jsonb not null default '{}',
  sources jsonb not null default '[]'
);
create index if not exists sector_research_sector_run on public.sector_research (sector, run_at desc);

-- Every Claude call: what it was for, what it used, and an estimated cost at list prices.
create table if not exists public.ai_runs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('sector', 'stock')),
  key text not null,                      -- sector name or stock symbol
  trigger text not null default 'weekly' check (trigger in ('weekly', 'manual')),
  model text,
  status text not null default 'running' check (status in ('running', 'ok', 'error', 'refused')),
  started_at timestamptz not null default now(),
  duration_ms integer,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  searches integer not null default 0,
  cost_usd numeric(10,5) not null default 0,
  error text
);
create index if not exists ai_runs_started on public.ai_runs (started_at desc);

alter table public.external_signals
  add column if not exists sector_research_id bigint references public.sector_research(id) on delete set null,
  add column if not exists ai_run_id bigint references public.ai_runs(id) on delete set null;

do $$
declare t text;
begin
  foreach t in array array['sector_research', 'ai_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_allowed())',
      t || '_read', t
    );
  end loop;
end $$;
