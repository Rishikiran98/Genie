# Genie evals

A regression harness for the *judgement* of the simulation engine. Unit
tests check that the code does what it says; these cases check that the
report says sensible things about ideas — and keep saying them after the
prose or the tuning constants change.

```bash
npm run eval                  # every case through the heuristic engine (fast, offline, deterministic)
npm run eval -- --only saas   # cases whose name contains "saas"
npm run eval -- --verbose     # dump the generated output for failing cases
npm run eval:llm              # same cases through the LLM path; needs GENIE_LLM_API_KEY, never runs in CI
```

Exit code is 0 only when every assertion in every case passes. CI runs the
heuristic mode as a reporting step; see the note at the bottom.

## What it tests

`evals/cases/*.json` holds 26 inputs spanning the reference marketplace case,
a plainly good B2B SaaS idea, a vague one-liner, a hardware idea, regulated
health / lending / alcohol / kids ideas, ideas with strong evidence and with
none, an obviously bad idea, and pairs that isolate one variable (budget
magnitude, solo founder, a mild deadline, stated vs. absent differentiation).

Each case is checked for:

- **Determinism** — the same input produces byte-identical output (implicit
  for every case in heuristic mode).
- **Score bands** — e.g. the reference marketplace lands in desirability
  55–70 with confidence ≤ 55 and feasibility ≤ 45.
- **Relative movements** — a score compared with the same input minus one
  field (`lowerThan` / `higherThan` / `sameAs` with a `variant`), e.g.
  feasibility drops by ≥ 15 when the constraints are present.
- **Properties of the prose** — a field matches or does not match a pattern
  (`matches` / `notMatches`), an array has a matching item (`contains`),
  the first matching item sits at a given index (`firstMatch`, used for
  "the regulatory risk is `risks[0]`").
- **Binding constraint** — `binding.kind` and the fields that must follow it
  (experiment, recommendation, action-plan Day 1).
- **Presentation** — `noEllipsis` and `noRawIdea`: no truncated idea text is
  ever pasted into the output.

The subject an assertion can look at is:

```
input        the parsed SimulationInput
report       SimulationReport (scores, prose, risks, nextSteps, ...)
plan         ActionPlan       (dailyPlan[0] is the binding constraint's day)
binding      { kind, label, ... } from bindingConstraint(input)
scenarios    { optimistic, realistic, ... } (heuristic mode only)
```

Field paths use dots and indexes: `report.scores.desirability`,
`plan.dailyPlan[0].focus`, `report.risks[0]`.

## Adding a case

1. Copy any file in `evals/cases/`, give it a fresh number and a name that
   says what the case isolates (`27-two-sided-with-evidence.json`).
2. Write the input exactly as a user would (the idea plus any of
   `targetUser`, `goal`, `constraints`, `timeline`, `evidence`).
3. Add assertions for the judgement you care about — a band, a relative
   movement against a variant, a required theme in a field, an ordering.
   Include `noEllipsis` and `noRawIdea`.
4. Run `npm run eval -- --only <name>`; then the whole suite.

Assertion shapes (all patterns are case-insensitive regexes unless `flags`
is given):

```jsonc
{ "type": "band",       "field": "report.scores.feasibility", "min": 40, "max": 60 }
{ "type": "equals",     "field": "binding.kind", "value": "regulatory" }
{ "type": "matches",    "field": "report.experimentDesign", "pattern": "legal|jurisdiction" }
{ "type": "notMatches", "field": "report.recommendation",   "pattern": "proceed with building" }
{ "type": "contains",   "field": "report.risks", "pattern": "cold start" }
{ "type": "firstMatch", "field": "report.risks", "pattern": "regulat", "index": 0 }
{ "type": "lowerThan",  "field": "report.scores.feasibility", "variant": { "constraints": null }, "by": 15 }
{ "type": "higherThan", "field": "report.scores.confidence",  "variant": { "evidence": null },   "by": 10 }
{ "type": "sameAs",     "field": "report.scores.feasibility", "variant": { "constraints": null } }
{ "type": "noEllipsis" }
{ "type": "noRawIdea" }
```

A `variant` is the case input with the listed fields overridden; `null`
removes a field.

## The standing principle

**Assert on bands and properties, never on exact strings.** The report's
wording will change; its judgement should not. A case that pins a sentence
verbatim breaks on every copy edit and protects nothing. A case that says
"the regulatory risk is first, the experiment mentions legality, desirability
stays under 70 without evidence" survives rewrites and fails only when the
engine starts giving worse advice.

Scores are ordinal signals, not measurements — the bands are wide on purpose.
Tighten a band only when a real regression slipped through it.

## CI

The workflow runs `npm run eval` after the unit tests as a **reporting step**
(`continue-on-error: true`). Once it has been green across a few unrelated
PRs, remove that line to make it blocking.

The `--llm` mode is for local use when tuning `prompt.ts`: it scores the
same assertions against real model output, so you can see which judgement
rules the model is and is not following. It costs API calls and is
non-deterministic, so it never runs in CI.
