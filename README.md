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
  and build + validation checklists.

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
components/                # Dashboard, score cards, scenario + action-plan panels
lib/simulation/
  schema.ts                # Zod schema + types (the report contract)
  prompt.ts                # System / user prompt templates
  heuristic.ts             # Deterministic offline engine
  provider.ts              # OpenAI-compatible LLM adapter (shared chatJson)
  engine.ts                # Simulation dispatch + fallback logic
  scenario.ts              # Scenario lenses, engine + dispatch
  actionplan.ts            # Action plan engine + dispatch
  engine.test.ts           # Simulation unit tests
  scenario.test.ts         # Scenario unit tests
  actionplan.test.ts       # Action plan unit tests
```

## Tech stack

Next.js (App Router) · TypeScript · Tailwind CSS · Zod · Vitest.

## Roadmap

Done so far: the simulation engine, scenario testing, and the action plan
generator. Next up:

- **Clarifying questions** — sharpen vague ideas before simulating.
- **Saved simulations** — persistence (PostgreSQL + pgvector memory).
- **Auth & accounts** — so users can revisit and compare past ideas.
