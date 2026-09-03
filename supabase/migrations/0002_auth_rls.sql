-- Genie: per-user persistence (Supabase Auth + Row Level Security).
--
-- Apply AFTER 0001_init_simulations.sql. Review before applying.
--
-- What this does:
--   1. Adds the columns the app has been writing since the decision-flow
--      release (0001 predates them; without these, inserts fail).
--   2. Adds `user_id` (owner) to simulations, defaulting to the caller's
--      auth.uid() so a signed-in insert is always attributed.
--   3. Enables RLS on simulations and scenarios and restricts every operation
--      to the owning user. Anonymous callers (no JWT) see and write nothing.
--
-- Existing rows: anything inserted before this migration has user_id NULL and
-- becomes invisible to everyone once RLS is on. Either delete them or backfill
-- them to a specific user, e.g.
--   update public.simulations set user_id = '<auth.users.id>' where user_id is null;

-- 1. Columns the app writes that 0001 did not define.
alter table public.simulations
  add column if not exists target_user           text,
  add column if not exists goal                  text,
  add column if not exists constraints           text,
  add column if not exists evidence              text,
  add column if not exists desirability_score    integer,
  add column if not exists feasibility_score     integer,
  add column if not exists differentiation_score integer,
  add column if not exists execution_risk_score  integer,
  add column if not exists confidence_score      integer,
  add column if not exists decision              text;

-- 2. Ownership.
alter table public.simulations
  add column if not exists user_id uuid references auth.users (id) on delete cascade
    default auth.uid();

create index if not exists simulations_user_id_created_at_idx
  on public.simulations (user_id, created_at desc);

-- 3. Row Level Security: owner-only access.
alter table public.simulations enable row level security;

drop policy if exists "simulations_select_own" on public.simulations;
create policy "simulations_select_own" on public.simulations
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "simulations_insert_own" on public.simulations;
create policy "simulations_insert_own" on public.simulations
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "simulations_update_own" on public.simulations;
create policy "simulations_update_own" on public.simulations
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "simulations_delete_own" on public.simulations;
create policy "simulations_delete_own" on public.simulations
  for delete to authenticated
  using (auth.uid() = user_id);

-- Scenarios inherit ownership through their parent simulation.
alter table public.scenarios enable row level security;

drop policy if exists "scenarios_owner_all" on public.scenarios;
create policy "scenarios_owner_all" on public.scenarios
  for all to authenticated
  using (
    exists (
      select 1 from public.simulations s
      where s.id = scenarios.simulation_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.simulations s
      where s.id = scenarios.simulation_id and s.user_id = auth.uid()
    )
  );
