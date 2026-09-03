# Genie

**Test ideas before you waste time building them.**

Genie is an idea & decision **simulation engine**. You describe a goal, idea,
plan, or decision in plain language, and Genie turns it into a clear, scored,
practical report — summary, target user, market read, risks, an MVP suggestion,
and concrete next steps — instead of a wall of generic chatbot text.

This repository currently implements:

- the **simulation engine** — *idea input → structured, scored report*, and
- **scenario testing** — replay the idea through best / worst / realistic /
  cheap-MVP / fastest / long-term lenses and see how the scores shift, and
- the **action plan generator** — a day-by-day first week, a 30-day roadmap,
  and build + validation checklists, and
- **saved simulations** — keep simulations and reopen them later, with
  at-a-glance scores for comparison (browser storage by default, optional
  Supabase backend).

## How it works

```
idea (+ optional audience / timeline)
        │
        ▼
  /api/simulate  ──►  runSimulation()
                          │
            ┌─────────────┴──────────────┐
        LLM engine                  Offline engine
   (if GENIE_LLM_API_KEY set)   (deterministic heuristic,
    OpenAI-compatible API)       always available)
                          │
                          ▼
              schema-validated SimulationReport
                          │
                          ▼
                  Dashboard with scores
```

Genie **runs with zero configuration**: when no LLM key is present (or the LLM
call fails), it falls back to a deterministic, offline heuristic engine so you
always get a complete, schema-valid report. Configure an LLM for richer output.

## Quickstart

```bash
npm install
npm run dev        # http://localhost:3000
```

Open the app, type an idea (or click an example), and hit **Simulate**.

### Optional: use a real LLM

Copy `.env.example` to `.env.local` and set an OpenAI-compatible endpoint:

```bash
GENIE_LLM_API_KEY=sk-...
GENIE_LLM_BASE_URL=https://api.openai.com/v1
GENIE_LLM_MODEL=gpt-4o-mini
```

The report's badge shows whether it came from the **LLM engine** or the
**Offline engine**.

## API behaviour

All three routes (`/api/simulate`, `/api/scenario`, `/api/actionplan`) are
`POST` with a JSON body and share the same guards:

| Status | When                                                        |
| ------ | ----------------------------------------------------------- |
| `200`  | Report generated (`engine` says `"llm"` or `"heuristic"`)    |
| `400`  | Malformed JSON, or validation failed (`issues` lists them)   |
| `413`  | Body larger than 32 KB                                       |
| `429`  | More than `GENIE_RATE_LIMIT` requests/min from one IP on that route (`Retry-After` header set) |
| `500`  | Unexpected error                                             |

Every error response is `{ "error": string }`. Rate limiting is in-memory and
therefore per instance on serverless hosts; LLM calls are capped by
`GENIE_LLM_TIMEOUT_MS` (default 20 s) and fall back to the offline engine on
timeout.

`GET /api/health` returns `{ status: "ok", llmConfigured, store }` where
`store` is `"supabase"` or `"local"`. It reads configuration only — no secrets,
no upstream calls — so it is safe for uptime probes.

## Observability

Genie writes one JSON object per line to stdout (`lib/log.ts`), no vendor
required. The events that matter:

- `simulation.completed` — `feature`, `engine` (`llm`/`heuristic`),
  `llmConfigured`, `fallback`, `durationMs`. **Fallback rate** is the share of
  these lines with `"fallback":true` among those with `"llmConfigured":true`.
- `llm.failed` — one per silent fallback, with `errorKind` set to `network`,
  `timeout`, `status`, `schema`, or `unknown`, so you can see *why*.
- `ratelimit.exceeded`, `request.received` / `request.completed`,
  `request.failed` (500s, with stack).

Client IPs are logged only as a salted hash (`ipHash`). Set `GENIE_LOG_LEVEL`
(`debug` … `silent`) to tune verbosity.

## Scripts

| Command            | What it does                          |
| ------------------ | ------------------------------------- |
| `npm run dev`      | Start the dev server                  |
| `npm run build`    | Production build                      |
| `npm run test`     | Engine unit tests + route integration tests (Vitest) |
| `npm run test:coverage` | Same, with a v8 coverage report (no threshold yet) |
| `npm run typecheck`| Type-check with `tsc`                 |
| `npm run lint`     | Next.js / ESLint                      |

CI runs lint → typecheck → tests with coverage → build on every push and PR.

## Project layout

```
app/
  page.tsx                 # Home: idea input + dashboard + scenarios + plan
  api/simulate/route.ts    # POST: validate → simulate → JSON
  api/scenario/route.ts    # POST: validate → run one scenario → JSON
  api/actionplan/route.ts  # POST: validate → generate action plan → JSON
  api/health/route.ts      # GET: { status, llmConfigured, store }
  api/*/route.test.ts      # Route-level integration tests (handlers called with Request objects)
components/                # Dashboard, score cards, scenario/action-plan/saved panels
lib/
  http.ts                  # Shared route pipeline: rate limit → size guard → parse → run → log
  ratelimit.ts             # In-memory fixed-window limiter (per IP, per route)
  log.ts                   # Structured JSON logger (stdout)
lib/simulation/
  schema.ts                # Zod schema + types (the report contract)
  prompt.ts                # System / user prompt templates
  heuristic.ts             # Deterministic offline engine
  provider.ts              # OpenAI-compatible LLM adapter (shared chatJson)
  engine.ts                # Simulation dispatch + fallback logic
  telemetry.ts             # Fallback / completion log events shared by dispatchers
  scenario.ts              # Scenario lenses, engine + dispatch
  actionplan.ts            # Action plan engine + dispatch
  *.test.ts                # Unit tests per module
lib/storage/
  types.ts                 # SimulationStore interface + SavedSimulation type
  local.ts                 # Browser (localStorage) store — the default
  supabase.ts              # Supabase store (opt-in; per-user rows, needs a session)
  index.ts                 # getStore() factory (env + session → backend), shared Supabase client
components/AuthPanel.tsx   # Magic-link sign-in; renders only when Supabase is configured
supabase/migrations/       # SQL schema for the optional Supabase backend (0001 tables, 0002 auth + RLS)
supabase/verify_rls.sh     # Replays the migrations on a local Postgres and asserts the RLS policies
```

## Persistence

Saved simulations use a small `SimulationStore` interface with two backends:

- **Browser (default)** — `localStorage`. Zero setup, survives reloads, scoped
  to the device. This is what runs out of the box, and what signed-out users
  get even when Supabase is configured.
- **Supabase (opt-in)** — set `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, apply both migrations, and sign in. Rows
  are owned by the signed-in user and protected by Row Level Security, so a
  shared deployment is safe for multiple people.

### Supabase setup

1. Create a Supabase project and enable the **Email** provider (magic links
   are on by default) under *Authentication → Providers*.
2. Apply the migrations, in order, in the SQL editor or with the Supabase CLI:
   - `supabase/migrations/0001_init_simulations.sql` — tables.
   - `supabase/migrations/0002_auth_rls.sql` — the columns the app writes,
     `user_id` (defaults to `auth.uid()`), and owner-only RLS policies on
     `simulations` and `scenarios`. Rows that existed before `0002` have no
     owner and become invisible; the migration header explains how to
     backfill them.
3. Put the project URL and anon key in `.env.local`, and add your site URL
   to *Authentication → URL Configuration* so magic links redirect back.
4. Restart the dev server. A sign-in box appears above saved simulations.
   Signed out, everything still lives in the browser; sign in with a magic
   link and saved simulations sync to your account instead.

Neither migration is applied for you — review them first. The RLS policies
are **not** exercised in CI; `supabase/verify_rls.sh` replays both migrations
against a local Postgres that emulates `auth.uid()` and asserts owner-only
select/insert/update/delete plus anonymous denial. It was run against
Postgres 16 before this landed. Verify against your own project after
applying (sign in as two users and confirm neither sees the other's rows).

## Tech stack

Next.js (App Router) · TypeScript · Tailwind CSS · Zod · Vitest.

## Roadmap

Done so far: the simulation engine, scenario testing, the action plan
generator, saved simulations, and auth & accounts (Supabase magic-link
sign-in with per-user rows behind RLS). Next up:

- **Clarifying questions** — sharpen vague ideas before simulating.
- **Semantic memory** — pgvector over past simulations.
