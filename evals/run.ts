/**
 * Genie eval harness.
 *
 * Runs every case in evals/cases/*.json through the heuristic engine (or,
 * with --llm, the LLM path) and checks the case's assertions. Assertions are
 * bands and properties — never exact strings — so the suite survives prose
 * changes and only fails when judgement regresses.
 *
 *   npm run eval                 # heuristic, deterministic, no network
 *   npm run eval -- --only saas  # cases whose name contains "saas"
 *   npm run eval -- --verbose    # print the subject for failing cases
 *   npm run eval -- --llm        # same cases through the LLM (needs GENIE_LLM_API_KEY)
 *
 * Exit code 0 when every assertion passes, 1 otherwise, 2 on a usage error.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { heuristicActionPlan, llmActionPlan, type ActionPlan } from "../lib/simulation/actionplan";
import { bindingConstraint, heuristicSimulation, type BindingConstraint } from "../lib/simulation/heuristic";
import { llmSimulation, readLlmConfig } from "../lib/simulation/provider";
import { SCENARIO_TYPES, heuristicScenario, type ScenarioReport, type ScenarioType } from "../lib/simulation/scenario";
import { simulationInputSchema, type SimulationInput, type SimulationReport } from "../lib/simulation/schema";

// Keep engine log lines out of the report unless the caller asked for them.
process.env.GENIE_LOG_LEVEL ??= "silent";

// ---------------------------------------------------------------------------
// Case + assertion shapes
// ---------------------------------------------------------------------------

/** Overrides applied to the case input to build a comparison variant; `null` removes a field. */
type Variant = Partial<Record<keyof SimulationInput, string | null>>;

type Assertion =
  | { type: "band"; field: string; min?: number; max?: number }
  | { type: "equals"; field: string; value: unknown }
  | { type: "matches"; field: string; pattern: string; flags?: string }
  | { type: "notMatches"; field: string; pattern: string; flags?: string }
  /** Some element of an array field matches. */
  | { type: "contains"; field: string; pattern: string; flags?: string }
  /** The first element matching `pattern` sits at `index`. */
  | { type: "firstMatch"; field: string; pattern: string; flags?: string; index: number }
  /** `field` on this case is lower than the same field on the variant, by at least `by` (default 1). */
  | { type: "lowerThan"; field: string; variant: Variant; by?: number }
  | { type: "higherThan"; field: string; variant: Variant; by?: number }
  | { type: "sameAs"; field: string; variant: Variant }
  /** No truncation ellipsis anywhere in the generated output. */
  | { type: "noEllipsis" }
  /** The raw idea text is never pasted into the output. */
  | { type: "noRawIdea" };

interface EvalCase {
  name: string;
  description?: string;
  input: SimulationInput;
  assertions: Assertion[];
}

/** Everything an assertion can look at. */
interface Subject {
  input: SimulationInput;
  report: SimulationReport;
  plan: ActionPlan;
  binding: BindingConstraint;
  scenarios?: Record<ScenarioType, ScenarioReport>;
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

type Engine = (input: SimulationInput) => Promise<Subject>;

const heuristicEngine: Engine = async (input) => {
  const report = heuristicSimulation(input);
  const scenarios = Object.fromEntries(
    SCENARIO_TYPES.map((t) => [t, heuristicScenario(input, report, t)]),
  ) as Record<ScenarioType, ScenarioReport>;
  return { input, report, plan: heuristicActionPlan(input, report), binding: bindingConstraint(input), scenarios };
};

function llmEngine(): Engine {
  const config = readLlmConfig();
  if (!config) {
    console.error("--llm needs GENIE_LLM_API_KEY (and optionally GENIE_LLM_BASE_URL / GENIE_LLM_MODEL).");
    process.exit(2);
  }
  return async (input) => {
    const report = await llmSimulation(input, config);
    const plan = await llmActionPlan(input, heuristicSimulation(input), config);
    // The binding constraint is an input-side analysis, so it is the same
    // under both engines; scenarios are skipped in LLM mode to bound cost.
    return { input, report, plan, binding: bindingConstraint(input) };
  };
}

// ---------------------------------------------------------------------------
// Assertion evaluation
// ---------------------------------------------------------------------------

/** Resolves "report.scores.desirability" or "plan.dailyPlan[0].focus" against a subject. */
function resolve(subject: Subject, path: string): unknown {
  const parts = path.split(".").flatMap((p) => p.split(/[[\]]/).filter(Boolean));
  let cur: unknown = subject;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function applyVariant(input: SimulationInput, variant: Variant): SimulationInput {
  const next: Record<string, unknown> = { ...input };
  for (const [key, value] of Object.entries(variant)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return simulationInputSchema.parse(next);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

interface Outcome {
  ok: boolean;
  label: string;
  detail?: string;
}

async function check(a: Assertion, subject: Subject, engine: Engine, llm: boolean): Promise<Outcome> {
  const label = describe(a);
  if ("field" in a && a.field.startsWith("scenarios") && llm) {
    return { ok: true, label: `${label} (skipped in --llm mode)` };
  }
  switch (a.type) {
    case "band": {
      const v = resolve(subject, a.field);
      if (typeof v !== "number") return { ok: false, label, detail: `not a number: ${asText(v)}` };
      const ok = (a.min === undefined || v >= a.min) && (a.max === undefined || v <= a.max);
      return { ok, label, detail: ok ? undefined : `got ${v}` };
    }
    case "equals": {
      const v = resolve(subject, a.field);
      return { ok: v === a.value, label, detail: `got ${asText(v)}` };
    }
    case "matches":
    case "notMatches": {
      const v = asText(resolve(subject, a.field));
      const hit = new RegExp(a.pattern, a.flags ?? "i").test(v);
      const ok = a.type === "matches" ? hit : !hit;
      return { ok, label, detail: ok ? undefined : `value: ${v.slice(0, 160)}` };
    }
    case "contains": {
      const v = resolve(subject, a.field);
      if (!Array.isArray(v)) return { ok: false, label, detail: `not an array: ${asText(v)}` };
      const re = new RegExp(a.pattern, a.flags ?? "i");
      const ok = v.some((item) => re.test(asText(item)));
      return { ok, label, detail: ok ? undefined : `items: ${v.map(asText).join(" | ").slice(0, 240)}` };
    }
    case "firstMatch": {
      const v = resolve(subject, a.field);
      if (!Array.isArray(v)) return { ok: false, label, detail: `not an array: ${asText(v)}` };
      const re = new RegExp(a.pattern, a.flags ?? "i");
      const idx = v.findIndex((item) => re.test(asText(item)));
      return { ok: idx === a.index, label, detail: `first match at ${idx}` };
    }
    case "lowerThan":
    case "higherThan":
    case "sameAs": {
      const other = await engine(applyVariant(subject.input, a.variant));
      const mine = resolve(subject, a.field);
      const theirs = resolve(other, a.field);
      if (typeof mine !== "number" || typeof theirs !== "number") {
        return { ok: false, label, detail: `not numbers: ${asText(mine)} vs ${asText(theirs)}` };
      }
      const by = "by" in a ? (a.by ?? 1) : 0;
      const ok =
        a.type === "lowerThan" ? mine <= theirs - by : a.type === "higherThan" ? mine >= theirs + by : mine === theirs;
      return { ok, label, detail: `${mine} vs variant ${theirs}` };
    }
    case "noEllipsis": {
      const text = JSON.stringify({ report: subject.report, plan: subject.plan, scenarios: subject.scenarios ?? {} });
      const ok = !text.includes("…") && !text.includes("...");
      return { ok, label, detail: ok ? undefined : "found an ellipsis in the output" };
    }
    case "noRawIdea": {
      const text = JSON.stringify({ report: subject.report, plan: subject.plan, scenarios: subject.scenarios ?? {} });
      const idea = subject.input.idea.trim().replace(/[.?!]+$/, "");
      const ok = !text.includes(idea);
      return { ok, label, detail: ok ? undefined : "the full idea text appears in the output" };
    }
  }
}

function describe(a: Assertion): string {
  switch (a.type) {
    case "band":
      return `${a.field} in [${a.min ?? "-∞"}, ${a.max ?? "∞"}]`;
    case "equals":
      return `${a.field} == ${asText(a.value)}`;
    case "matches":
      return `${a.field} matches /${a.pattern}/`;
    case "notMatches":
      return `${a.field} does not match /${a.pattern}/`;
    case "contains":
      return `${a.field} has an item matching /${a.pattern}/`;
    case "firstMatch":
      return `first /${a.pattern}/ in ${a.field} is at index ${a.index}`;
    case "lowerThan":
      return `${a.field} lower than variant ${JSON.stringify(a.variant)} by ≥ ${a.by ?? 1}`;
    case "higherThan":
      return `${a.field} higher than variant ${JSON.stringify(a.variant)} by ≥ ${a.by ?? 1}`;
    case "sameAs":
      return `${a.field} same as variant ${JSON.stringify(a.variant)}`;
    case "noEllipsis":
      return "no truncation ellipsis in output";
    case "noRawIdea":
      return "raw idea text never pasted into output";
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function loadCases(dir: string, only?: string): EvalCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as EvalCase)
    .filter((c) => !only || c.name.includes(only));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const llm = args.includes("--llm");
  const verbose = args.includes("--verbose");
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;

  const engine = llm ? llmEngine() : heuristicEngine;
  const cases = loadCases(join(__dirname, "cases"), only);
  if (cases.length === 0) {
    console.error("No cases matched.");
    process.exit(2);
  }

  const rows: { name: string; passed: number; total: number }[] = [];
  let failures = 0;
  const started = Date.now();

  for (const c of cases) {
    const input = simulationInputSchema.parse(c.input);
    const subject = await engine(input);

    // Determinism is part of the contract for the heuristic engine.
    const outcomes: Outcome[] = [];
    if (!llm) {
      const again = await engine(input);
      const same = JSON.stringify(again) === JSON.stringify(subject);
      outcomes.push({ ok: same, label: "identical input → identical output", detail: same ? undefined : "outputs differ" });
    }
    for (const a of c.assertions) outcomes.push(await check(a, subject, engine, llm));

    const passed = outcomes.filter((o) => o.ok).length;
    rows.push({ name: c.name, passed, total: outcomes.length });
    const failed = outcomes.filter((o) => !o.ok);
    failures += failed.length;

    console.log(`${failed.length === 0 ? "PASS" : "FAIL"}  ${c.name}  (${passed}/${outcomes.length})`);
    for (const o of failed) console.log(`      ✗ ${o.label}${o.detail ? ` — ${o.detail}` : ""}`);
    if (verbose && failed.length > 0) console.log(JSON.stringify(subject, null, 2));
  }

  const width = Math.max(...rows.map((r) => r.name.length), 4);
  console.log(`\n${"case".padEnd(width)}  passed  status`);
  for (const r of rows) {
    console.log(`${r.name.padEnd(width)}  ${`${r.passed}/${r.total}`.padStart(6)}  ${r.passed === r.total ? "ok" : "FAIL"}`);
  }
  const total = rows.reduce((n, r) => n + r.total, 0);
  console.log(
    `\n${rows.filter((r) => r.passed === r.total).length}/${rows.length} cases, ${total - failures}/${total} assertions passed` +
      ` (${llm ? "llm" : "heuristic"} engine, ${Date.now() - started} ms)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
