import { z } from "zod";
import { heuristicSimulation, shortTopic } from "./heuristic";
import { chatJson, readLlmConfig, type LlmConfig } from "./provider";
import {
  scoreSchema,
  simulationInputSchema,
  type SimulationEngine,
  type SimulationInput,
  type SimulationReport,
} from "./schema";
import { logCompleted, logLlmFailure } from "./telemetry";

/**
 * Scenario testing: take an idea and replay it through a specific lens —
 * best case, realistic case, worst case, cheap MVP, fastest, or long term —
 * to see how the outcome and the scores shift.
 */

export const SCENARIO_TYPES = [
  "optimistic",
  "realistic",
  "pessimistic",
  "low_budget",
  "fast",
  "long_term",
] as const;

export type ScenarioType = (typeof SCENARIO_TYPES)[number];

export interface ScenarioMeta {
  type: ScenarioType;
  label: string;
  question: string;
}

/** Shared metadata matching the flowchart ordering and descriptions. */
export const SCENARIOS: Record<ScenarioType, ScenarioMeta> = {
  optimistic: { type: "optimistic", label: "Best case", question: "What must go right?" },
  realistic: { type: "realistic", label: "Realistic case", question: "What probably happens?" },
  pessimistic: { type: "pessimistic", label: "Worst case", question: "What breaks?" },
  low_budget: { type: "low_budget", label: "Cheap MVP", question: "Least $$$ to test it" },
  fast: { type: "fast", label: "Fastest", question: "Least time to signal" },
  long_term: { type: "long_term", label: "Long term", question: "Does this scale?" },
};

export const scenarioReportSchema = z.object({
  scenarioType: z.enum(SCENARIO_TYPES),
  label: z.string().min(1),
  /** A short story of how this path plays out. */
  narrative: z.string().min(1),
  /** Scores re-read under this scenario's assumptions (0-100). */
  scores: z.object({
    desirability: scoreSchema,
    feasibility: scoreSchema,
    differentiation: scoreSchema,
    executionRisk: scoreSchema,
    confidence: scoreSchema,
  }),
  /** What drives this particular outcome. */
  keyFactors: z.array(z.string().min(1)).min(1),
  /** What to do (or watch for) on this path. */
  moves: z.array(z.string().min(1)).min(1),
});

export type ScenarioReport = z.infer<typeof scenarioReportSchema>;

export const scenarioInputSchema = simulationInputSchema.extend({
  scenario: z.enum(SCENARIO_TYPES),
});

export type ScenarioInput = z.infer<typeof scenarioInputSchema>;

export interface ScenarioResult {
  report: ScenarioReport;
  engine: SimulationEngine;
}

// ---------------------------------------------------------------------------
// Heuristic scenario engine
// ---------------------------------------------------------------------------

type Scores = SimulationReport["scores"];

const clamp = (n: number): number => Math.max(5, Math.min(95, Math.round(n)));

/** Per-scenario deltas applied to the base scores. `executionRisk` is safety (higher = safer). */
const DELTAS: Record<ScenarioType, Scores> = {
  optimistic: { desirability: 20, feasibility: 12, differentiation: 15, executionRisk: 15, confidence: 15 },
  realistic: { desirability: -5, feasibility: -3, differentiation: -2, executionRisk: -4, confidence: 0 },
  pessimistic: { desirability: -22, feasibility: -15, differentiation: -10, executionRisk: -25, confidence: -20 },
  low_budget: { desirability: -8, feasibility: 15, differentiation: 5, executionRisk: 12, confidence: 8 },
  fast: { desirability: -5, feasibility: 18, differentiation: -5, executionRisk: -10, confidence: 5 },
  long_term: { desirability: 15, feasibility: -8, differentiation: 15, executionRisk: -5, confidence: 10 },
};

function applyDeltas(base: Scores, delta: Scores): Scores {
  return {
    desirability: clamp(base.desirability + delta.desirability),
    feasibility: clamp(base.feasibility + delta.feasibility),
    differentiation: clamp(base.differentiation + delta.differentiation),
    executionRisk: clamp(base.executionRisk + delta.executionRisk),
    confidence: clamp(base.confidence + delta.confidence),
  };
}

function narrativeFor(type: ScenarioType, topic: string, base: SimulationReport): string {
  switch (type) {
    case "optimistic":
      return `In the best case, "${topic}" finds its audience fast: a focused MVP nails the core job, early users become advocates, and momentum compounds. ${base.recommendation}`;
    case "realistic":
      return `Most likely, "${topic}" lands in the middle — adoption requires active distribution effort, with iterative pivots on positioning as feedback comes in.`;
    case "pessimistic":
      return `In the worst case, "${topic}" fails to gain traction: ${base.risks[0]} You spend months building only to face user indifference.`;
    case "low_budget":
      return `On a shoestring budget, you skip expensive infrastructure and run a manual test: ${base.experimentDesign} Cash risk is minimal.`;
    case "fast":
      return `On the fastest path, you cut scope to the absolute bone and ship "${topic}" in days to get immediate user signal.`;
    case "long_term":
      return `Playing the long game, "${topic}" scales through retention and word-of-mouth as user trust compounds over time.`;
  }
}

function factorsFor(type: ScenarioType, base: SimulationReport): string[] {
  switch (type) {
    case "optimistic":
      return [
        "You ship a focused MVP quickly and it nails the core user job.",
        "Early adopters turn into passionate advocates.",
        base.differentiation,
      ];
    case "realistic":
      return [
        "Adoption is gradual and demands ongoing, direct outreach.",
        "First positioning will need adjustment based on user feedback.",
        "Execution discipline matters more than initial hype.",
      ];
    case "pessimistic":
      return base.risks.slice(0, 3);
    case "low_budget":
      return [
        "Manual concierge delivery replaces custom automation.",
        "Landing page and direct outreach replace paid advertising.",
        "Financial cost is near zero; main investment is your time.",
      ];
    case "fast":
      return [
        "Ruthless scope cuts enable immediate testability.",
        "Fast release yields real user feedback before momentum wanes.",
        "Rough edges are accepted temporarily in exchange for speed.",
      ];
    case "long_term":
      return [
        "Compounding assets (audience, brand trust, network effects) drive sustainable advantage.",
        "High user retention beats short-term growth hacks.",
        "Focus shifts to scalability and operational resilience.",
      ];
  }
}

function movesFor(type: ScenarioType, base: SimulationReport): string[] {
  switch (type) {
    case "optimistic":
      return [
        "Double down on the channel bringing in your best users.",
        "Protect the core value proposition — avoid diluting with features.",
        "Capture testimonials and usage data to build social proof.",
      ];
    case "realistic":
      return base.nextSteps.slice(0, 3);
    case "pessimistic":
      return [
        "Define a kill criterion now: what metric by when makes you stop.",
        "Validate core assumptions before spending time building.",
        "Keep burn low so a wrong guess isn't fatal.",
      ];
    case "low_budget":
      return [
        "Use manual workarounds before automating backend logic.",
        "Build a simple waitlist page to measure demand before coding.",
        "Spend on validation, not infrastructure.",
      ];
    case "fast":
      return [
        "Time-box to a 7-day milestone and cut everything off the core path.",
        "Launch to a small friendly user group first.",
        "Iterate immediately based on initial user behavior.",
      ];
    case "long_term":
      return [
        "Invest in one owned distribution channel from day one.",
        "Optimize for high retention before scaling acquisition.",
        "Set 90-day milestones so long-term vision stays accountable.",
      ];
  }
}

export function heuristicScenario(
  input: SimulationInput,
  base: SimulationReport,
  type: ScenarioType,
): ScenarioReport {
  const topic = shortTopic(input.idea);
  return {
    scenarioType: type,
    label: SCENARIOS[type].label,
    narrative: narrativeFor(type, topic, base),
    scores: applyDeltas(base.scores, DELTAS[type]),
    keyFactors: factorsFor(type, base),
    moves: movesFor(type, base),
  };
}

// ---------------------------------------------------------------------------
// LLM scenario engine
// ---------------------------------------------------------------------------

const SCENARIO_SYSTEM_PROMPT = `You are Genie, a decision and idea simulation engine.
Given an idea and a baseline analysis, you re-simulate the idea under ONE
specific scenario lens and report how it plays out. Be specific, honest, and
concrete — show how this scenario changes the outcome and the scores.

Scores are 0-100. For "executionRisk", HIGHER MEANS SAFER (fewer/smaller risks).

Respond with ONLY a single JSON object (no markdown, no prose) matching exactly:
{
  "scenarioType": string,   // echo the requested scenario id
  "label": string,          // short human label for the scenario
  "narrative": string,      // 2-4 sentences on how this path plays out
  "scores": { "desirability": number, "feasibility": number, "differentiation": number, "executionRisk": number, "confidence": number },
  "keyFactors": string[],   // 2-4 things that drive this outcome
  "moves": string[]         // 2-4 concrete actions/watch-outs on this path
}`;

function buildScenarioPrompt(input: SimulationInput, base: SimulationReport, type: ScenarioType): string {
  const user = input.targetUser || input.audience;
  return [
    `Idea: ${input.idea}`,
    user ? `Target User: ${user}` : "",
    input.timeline ? `Timeline: ${input.timeline}` : "",
    `\nBaseline analysis (for context):`,
    JSON.stringify({ summary: base.summary, scores: base.scores, recommendation: base.recommendation }),
    `\nScenario to simulate: "${type}" — ${SCENARIOS[type].question}`,
    `Echo scenarioType as "${type}". Return the JSON object only.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function llmScenario(
  input: SimulationInput,
  base: SimulationReport,
  type: ScenarioType,
  config: LlmConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ScenarioReport> {
  const raw = await chatJson(config, SCENARIO_SYSTEM_PROMPT, buildScenarioPrompt(input, base, type), fetchImpl);
  return scenarioReportSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function runScenario(input: SimulationInput, type: ScenarioType): Promise<ScenarioResult> {
  const base = heuristicSimulation(input);
  const config = readLlmConfig();
  const startedAt = Date.now();

  if (config) {
    try {
      const report = await llmScenario(input, base, type, config);
      logCompleted("scenario", "llm", true, startedAt);
      return { report, engine: "llm" };
    } catch (err) {
      logLlmFailure("scenario", err);
    }
  }

  const result: ScenarioResult = { report: heuristicScenario(input, base, type), engine: "heuristic" };
  logCompleted("scenario", "heuristic", Boolean(config), startedAt);
  return result;
}

export async function scenarioFromRaw(raw: unknown): Promise<ScenarioResult> {
  const { scenario, ...input } = scenarioInputSchema.parse(raw);
  return runScenario(input, scenario);
}
