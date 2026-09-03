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

## Scripts

| Command            | What it does                          |
| ------------------ | ------------------------------------- |
| `npm run dev`      | Start the dev server                  |
| `npm run build`    | Production build                      |
| `npm run test`     | Run the engine unit tests (Vitest)    |
| `npm run typecheck`| Type-check with `tsc`                 |
| `npm run lint`     | Next.js / ESLint                      |

## Project layout

```
app/
  page.tsx                 # Home: idea input + dashboard + scenarios + plan
  api/simulate/route.ts    # POST: validate → simulate → JSON
  api/scenario/route.ts    # POST: validate → run one scenario → JSON
  api/actionplan/route.ts  # POST: validate → generate action plan → JSON
components/                # Dashboard, score cards, scenario/action-plan/saved panels
lib/
  http.ts                  # Shared route pipeline: rate limit → size guard → parse → run
  ratelimit.ts             # In-memory fixed-window limiter (per IP, per route)
lib/simulation/
  schema.ts                # Zod schema + types (the report contract)
  prompt.ts                # System / user prompt templates
  heuristic.ts             # Deterministic offline engine
  provider.ts              # OpenAI-compatible LLM adapter (shared chatJson)
  engine.ts                # Simulation dispatch + fallback logic
  scenario.ts              # Scenario lenses, engine + dispatch
  actionplan.ts            # Action plan engine + dispatch
  *.test.ts                # Unit tests per module
lib/storage/
  types.ts                 # SimulationStore interface + SavedSimulation type
  local.ts                 # Browser (localStorage) store — the default
  supabase.ts              # Supabase store (opt-in; inactive until configured)
  index.ts                 # getStore() factory (picks backend from env)
supabase/migrations/       # SQL schema for the optional Supabase backend
```

## Persistence

Saved simulations use a small `SimulationStore` interface with two backends:

- **Browser (default)** — `localStorage`. Zero setup, survives reloads, scoped
  to the device. This is what runs out of the box.
- **Supabase (opt-in)** — set `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and apply
  `supabase/migrations/0001_init_simulations.sql` to your project. `getStore()`
  then uses Supabase automatically (and falls back to browser storage if the
  client can't initialize).

> The migration is **not** applied for you — review it first. Until the auth
> slice lands, rows aren't scoped per user, so only enable Supabase for a
> private/single-user project.

## Tech stack

Next.js (App Router) · TypeScript · Tailwind CSS · Zod · Vitest.

## Roadmap

Done so far: the simulation engine, scenario testing, the action plan
generator, and saved simulations. Next up:

- **Auth & accounts** — scope saved data per user (Supabase Auth + RLS),
  which unblocks the multi-user Supabase backend.
- **Clarifying questions** — sharpen vague ideas before simulating.
- **Semantic memory** — pgvector over past simulations.
