#!/usr/bin/env bash
# Verifies migrations 0001 + 0002 and their RLS policies against a throwaway
# Postgres database that emulates the parts of Supabase they depend on
# (auth.users, auth.uid(), the anon/authenticated roles).
#
# Not run in CI (needs a Postgres server). Run it locally against any Postgres
# 14+ you can create databases on — standard PG* env vars select the server:
#
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres ./supabase/verify_rls.sh
#
# It creates and drops a database named genie_rls_check.
set -u
cd "$(dirname "$0")/.."
DB=genie_rls_check
PSQL="psql -X -t -A -d $DB"

psql -X -q -d postgres -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null || exit 1

$PSQL -v ON_ERROR_STOP=1 -q <<'SQL' || exit 1
create schema auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public, auth to anon, authenticated;
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
SQL

$PSQL -v ON_ERROR_STOP=1 -q -f supabase/migrations/0001_init_simulations.sql || exit 1
# A row written before RLS existed (no owner) — must become invisible.
$PSQL -q -c "insert into public.simulations (title, idea, report) values ('legacy', 'pre-auth row', '{}'::jsonb);"
$PSQL -v ON_ERROR_STOP=1 -q -f supabase/migrations/0002_auth_rls.sql || exit 1
$PSQL -q -c "grant all on all tables in schema public to anon, authenticated;"

A='11111111-1111-1111-1111-111111111111'; B='22222222-2222-2222-2222-222222222222'
as_user() { # role, uid, sql → last command tag / value / error line
  $PSQL -c "set role $1;" -c "select set_config('request.jwt.claim.sub', '$2', false);" -c "$3" 2>&1 \
    | grep -E '^(DELETE|UPDATE|INSERT) [0-9]|ERROR|^[0-9]+$' | tail -1
}
pass=0; fail=0
check() { # desc, actual, expected-regex
  if [[ "$2" =~ $3 ]]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 -> got: $2"; fail=$((fail+1)); fi
}

check "A inserts without user_id" \
  "$(as_user authenticated $A "insert into public.simulations (title, idea, report) values ('a1','idea a1','{}');")" "^INSERT 0 1$"
check "…and it defaulted to auth.uid()" \
  "$($PSQL -c "select count(*) from public.simulations where title='a1' and user_id='$A';")" "^1$"
check "A inserts with explicit own user_id" \
  "$(as_user authenticated $A "insert into public.simulations (title, idea, report, user_id) values ('a2','idea a2','{}','$A');")" "^INSERT 0 1$"
check "A inserting a row owned by B is rejected" \
  "$(as_user authenticated $A "insert into public.simulations (title, idea, report, user_id) values ('bad','x','{}','$B');")" "row-level security"
check "A sees only own rows (2), not the legacy NULL-owner row" \
  "$(as_user authenticated $A "select count(*) from public.simulations;")" "^2$"
check "B sees nothing" \
  "$(as_user authenticated $B "select count(*) from public.simulations;")" "^0$"
check "B cannot delete A's rows" \
  "$(as_user authenticated $B "delete from public.simulations where title='a1';")" "^DELETE 0$"
check "B cannot update A's rows" \
  "$(as_user authenticated $B "update public.simulations set title='hijacked' where title='a1';")" "^UPDATE 0$"
check "B cannot re-own A's rows" \
  "$(as_user authenticated $B "update public.simulations set user_id='$B';")" "^UPDATE 0$"
check "A can update own row" \
  "$(as_user authenticated $A "update public.simulations set title='a1-renamed' where title='a1';")" "^UPDATE 1$"
check "A cannot hand a row to B" \
  "$(as_user authenticated $A "update public.simulations set user_id='$B' where title='a2';")" "row-level security"
check "anon sees nothing" \
  "$(as_user anon '' "select count(*) from public.simulations;")" "^0$"
check "anon cannot insert" \
  "$(as_user anon '' "insert into public.simulations (title, idea, report) values ('anon','x','{}');")" "row-level security|null value in column \"user_id\""
SIM_A=$($PSQL -c "select id from public.simulations where title='a2';")
check "A can attach a scenario to own simulation" \
  "$(as_user authenticated $A "insert into public.scenarios (simulation_id, scenario_type, output) values ('$SIM_A','fast','{}');")" "^INSERT 0 1$"
check "B cannot attach a scenario to A's simulation" \
  "$(as_user authenticated $B "insert into public.scenarios (simulation_id, scenario_type, output) values ('$SIM_A','fast','{}');")" "row-level security"
check "B cannot read A's scenarios" \
  "$(as_user authenticated $B "select count(*) from public.scenarios;")" "^0$"
check "A can delete own row" \
  "$(as_user authenticated $A "delete from public.simulations where title='a1-renamed';")" "^DELETE 1$"
check "0002 is idempotent (re-apply succeeds)" \
  "$($PSQL -v ON_ERROR_STOP=1 -q -f supabase/migrations/0002_auth_rls.sql >/dev/null 2>&1 && echo ok)" "^ok$"

psql -X -q -d postgres -c "drop database if exists $DB;" >/dev/null
echo; echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
