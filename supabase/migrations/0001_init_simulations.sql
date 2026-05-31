-- Genie persistence schema.
--
-- ⚠ NOT YET APPLIED to any live database. Genie defaults to browser storage;
-- this migration is only needed if you opt into the Supabase backend by setting
-- NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
--
-- Review before applying. Row Level Security is intentionally deferred to the
-- auth slice: until per-user policies exist, rows are NOT scoped to a user, so
-- only enable this for a private/single-user project.

create extension if not exists "pgcrypto";

create table if not exists public.simulations (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  idea               text not null,
  audience           text,
  timeline           text,
  engine             text not null default 'heuristic',
  practicality_score integer,
  opportunity_score  integer,
  clarity_score      integer,
  risk_score         integer,
  summary            text,
  recommendation     text,
  report             jsonb not null,
  created_at         timestamptz not null default now()
);

create index if not exists simulations_created_at_idx
  on public.simulations (created_at desc);

-- Scenarios saved against a simulation (reserved for a future "save scenario"
-- feature; the app does not write to this table yet).
create table if not exists public.scenarios (
  id            uuid primary key default gen_random_uuid(),
  simulation_id uuid not null references public.simulations (id) on delete cascade,
  scenario_type text not null,
  output        jsonb not null,
  created_at    timestamptz not null default now()
);

-- TODO (auth slice): enable RLS and add per-user policies, e.g.
--   alter table public.simulations enable row level security;
--   create policy "owner can read"  on public.simulations for select using (auth.uid() = user_id);
--   create policy "owner can write" on public.simulations for insert with check (auth.uid() = user_id);
-- (requires adding a user_id column wired to Supabase Auth).
