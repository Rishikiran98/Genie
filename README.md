# Genie

**Test ideas before you waste time building them.**

Genie is an idea & decision **simulation engine**. You describe a goal, idea,
plan, or decision in plain language, and Genie turns it into a clear, scored,
practical report — summary, target user, market read, risks, an MVP suggestion,
and concrete next steps — instead of a wall of generic chatbot text.

This repository currently implements the **simulation engine slice**: the
end-to-end path from *idea input → structured, scored simulation report*.

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
  page.tsx                 # Home: idea input + dashboard
  api/simulate/route.ts    # POST endpoint: validate → simulate → JSON
components/                # Dashboard + score-card UI
lib/simulation/
  schema.ts                # Zod schema + types (the report contract)
  prompt.ts                # System / user prompt templates
  heuristic.ts             # Deterministic offline engine
  provider.ts              # OpenAI-compatible LLM adapter
  engine.ts                # Dispatch + fallback logic
  engine.test.ts           # Unit tests
```

## Tech stack

Next.js (App Router) · TypeScript · Tailwind CSS · Zod · Vitest.

## Roadmap

This slice is step one of the broader MVP. Next up:

- **Scenario testing** — best / worst / realistic / cheap-MVP / fast paths.
- **Action plan generator** — Day 1–7 and 30-day roadmaps.
- **Saved simulations** — persistence (PostgreSQL + pgvector memory).
- **Auth & accounts** — so users can revisit and compare past ideas.
