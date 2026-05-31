-- Genie persistence schema (auth-aware).
--
-- Apply this to the Supabase project that backs Genie, then set
-- NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. Rows are scoped
-- per user via Row Level Security, so a signed-in user only ever sees their
-- own simulations. Sign-in uses Supabase Auth (OAuth) — enable the Google /
-- GitHub providers in the dashboard.

create extension if not exists "pgcrypto";

create table if not exists public.simulations (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
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

create index if not exists simulations_user_created_idx
  on public.simulations (user_id, created_at desc);

alter table public.simulations enable row level security;

create policy "Users read own simulations"
  on public.simulations for select using (auth.uid() = user_id);
create policy "Users insert own simulations"
  on public.simulations for insert with check (auth.uid() = user_id);
create policy "Users update own simulations"
  on public.simulations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own simulations"
  on public.simulations for delete using (auth.uid() = user_id);

-- Scenarios saved against a simulation (reserved for a future "save scenario"
-- feature; the app does not write to this table yet). Ownership is inherited
-- from the parent simulation.
create table if not exists public.scenarios (
  id            uuid primary key default gen_random_uuid(),
  simulation_id uuid not null references public.simulations (id) on delete cascade,
  scenario_type text not null,
  output        jsonb not null,
  created_at    timestamptz not null default now()
);

alter table public.scenarios enable row level security;

create policy "Users read own scenarios"
  on public.scenarios for select using (
    exists (select 1 from public.simulations s where s.id = simulation_id and s.user_id = auth.uid())
  );
create policy "Users insert own scenarios"
  on public.scenarios for insert with check (
    exists (select 1 from public.simulations s where s.id = simulation_id and s.user_id = auth.uid())
  );
create policy "Users delete own scenarios"
  on public.scenarios for delete using (
    exists (select 1 from public.simulations s where s.id = simulation_id and s.user_id = auth.uid())
  );
