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
  at-a-glance scores for comparison, and
- **accounts** — optional OAuth sign-in (Supabase Auth); signed-in users get
  their saves synced server-side and scoped to them via Row Level Security.

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
components/                # Dashboard, score cards, panels, auth UI
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
  local.ts                 # Browser (localStorage) store — default / signed-out
  supabase.ts              # Supabase store (used when signed in)
  index.ts                 # getStore() factory (follows auth state)
lib/supabase/
  client.ts                # Browser Supabase client + config detection
supabase/migrations/       # Auth-aware SQL schema (RLS per user)
```

## Persistence & accounts

Saved simulations use a small `SimulationStore` interface that follows the
auth state:

- **Browser (default / signed-out)** — `localStorage`. Zero setup, survives
  reloads, scoped to the device. This is what runs out of the box, and what
  signed-out visitors get even when Supabase is configured.
- **Supabase (signed-in)** — once `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set and a user signs in, saves go to
  Postgres, scoped to that user via Row Level Security.

### Enabling accounts (Supabase)

1. Apply `supabase/migrations/0001_init_simulations.sql` to your project
   (creates the `simulations` table, `user_id`, and per-user RLS policies).
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (these
   are inlined at **build** time, so set them before building/deploying).
3. In the Supabase dashboard → **Authentication → Providers**, enable **Google**
   and/or **GitHub** and add their OAuth client id/secret.
4. In **Authentication → URL Configuration**, set the Site URL and add your
   app origins (e.g. `http://localhost:3000` and your production URL) to the
   redirect allow-list.

> NEXT_PUBLIC keys are public by design. Security comes from RLS, so the
> migration's per-user policies are what keep one user's data private.

## Tech stack

Next.js (App Router) · TypeScript · Tailwind CSS · Zod · Vitest.

## Roadmap

Done so far: the simulation engine, scenario testing, the action plan
generator, saved simulations, and accounts (OAuth + per-user data). Next up:

- **Clarifying questions** — sharpen vague ideas before simulating.
- **Semantic memory** — pgvector over past simulations.
- **Saved scenarios** — persist generated scenarios (table already in place).
