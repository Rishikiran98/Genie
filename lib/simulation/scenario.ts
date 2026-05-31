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

/**
 * Scenario testing: take an idea and replay it through a specific lens —
 * best case, worst case, most likely, cheapest path, fastest path, or the long
 * game — to see how the outcome and the scores shift. This is what makes Genie
 * feel like a simulator rather than a one-shot report.
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

/** Shared metadata so the UI and the engine agree on labels and ordering. */
export const SCENARIOS: Record<ScenarioType, ScenarioMeta> = {
  optimistic: { type: "optimistic", label: "Best case", question: "What if everything goes right?" },
  realistic: { type: "realistic", label: "Most likely", question: "What's the realistic outcome?" },
  pessimistic: { type: "pessimistic", label: "Worst case", question: "What if it fails?" },
  low_budget: { type: "low_budget", label: "Cheap MVP path", question: "What's the cheapest way to test this?" },
  fast: { type: "fast", label: "Fastest path", question: "What if I shipped it in days?" },
  long_term: { type: "long_term", label: "Long-term path", question: "What if I play the long game?" },
};

export const scenarioReportSchema = z.object({
  scenarioType: z.enum(SCENARIO_TYPES),
  label: z.string().min(1),
  /** A short story of how this path plays out. */
  narrative: z.string().min(1),
  /** Scores re-read under this scenario's assumptions (0-100, risk: higher = safer). */
  scores: z.object({
    practicality: scoreSchema,
    opportunity: scoreSchema,
    clarity: scoreSchema,
    risk: scoreSchema,
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

/** Per-scenario deltas applied to the base scores. `risk` is safety (higher = safer). */
const DELTAS: Record<ScenarioType, Scores> = {
  optimistic: { practicality: 12, opportunity: 20, clarity: 5, risk: 15 },
  realistic: { practicality: -3, opportunity: -5, clarity: 0, risk: -4 },
  pessimistic: { practicality: -15, opportunity: -22, clarity: -4, risk: -25 },
  low_budget: { practicality: 15, opportunity: -8, clarity: 2, risk: 12 },
  fast: { practicality: 8, opportunity: -5, clarity: -3, risk: -8 },
  long_term: { practicality: -6, opportunity: 15, clarity: 3, risk: -5 },
};

function applyDeltas(base: Scores, delta: Scores): Scores {
  return {
    practicality: clamp(base.practicality + delta.practicality),
    opportunity: clamp(base.opportunity + delta.opportunity),
    clarity: clamp(base.clarity + delta.clarity),
    risk: clamp(base.risk + delta.risk),
  };
}

function narrativeFor(type: ScenarioType, topic: string, base: SimulationReport): string {
  switch (type) {
    case "optimistic":
      return `In the best case, "${topic}" finds its audience fast: a focused MVP nails the core job, early users become advocates, and momentum compounds before competitors react. ${base.recommendation}`;
    case "realistic":
      return `Most likely, "${topic}" lands in the middle — slower adoption than you hope, a pivot or two on positioning, and steady progress only if you stay close to users. ${base.recommendation}`;
    case "pessimistic":
      return `In the worst case, "${topic}" never gains traction: ${base.risks[0]} You build for months, launch to silence, and can't tell whether the idea or the execution was at fault.`;
    case "low_budget":
      return `On a shoestring, you skip infrastructure and run the thinnest manual version: ${base.mvpSuggestion} It's unglamorous, but it proves — or kills — the idea for almost nothing.`;
    case "fast":
      return `On the fastest path, you cut scope hard and ship "${topic}" in days, not months — one core action, no accounts, no polish. You trade robustness for a real signal now.`;
    case "long_term":
      return `Playing the long game, "${topic}" compounds: durable distribution, a product deepened around a loyal audience, and retention plus word-of-mouth doing the heavy lifting over 12+ months.`;
  }
}

function factorsFor(type: ScenarioType, base: SimulationReport): string[] {
  switch (type) {
    case "optimistic":
      return [
        "You ship a focused MVP quickly and it nails the core job.",
        "Early adopters turn into advocates who pull in the next users.",
        base.differentiation,
      ];
    case "realistic":
      return [
        "Adoption is gradual and demands real, ongoing distribution effort.",
        "Your first positioning is probably slightly off and needs iteration.",
        "Execution discipline ends up mattering more than the original idea.",
      ];
    case "pessimistic":
      return base.risks.slice(0, 3);
    case "low_budget":
      return [
        "Manual, concierge-style delivery replaces automation early on.",
        "No-code and off-the-shelf tools stand in for any custom build.",
        "Cash risk is minimal — the main cost is your own time.",
      ];
    case "fast":
      return [
        "Ruthless scope cuts get you to a testable version immediately.",
        "Speed surfaces real feedback before your motivation fades.",
        "Rough edges and technical debt are accepted — temporarily.",
      ];
    case "long_term":
      return [
        "Compounding assets — audience, content, data — beat one-off launches.",
        "Retention and trust matter more than any initial growth spike.",
        "The risk shifts from 'will it work' to 'can you sustain focus'.",
      ];
  }
}

function movesFor(type: ScenarioType, base: SimulationReport): string[] {
  switch (type) {
    case "optimistic":
      return [
        "Double down on the channel bringing in your best users.",
        "Protect the core experience — resist diluting it with features.",
        "Capture testimonials and usage data to compound momentum.",
      ];
    case "realistic":
      return base.nextSteps.slice(0, 3);
    case "pessimistic":
      return [
        "Define a kill criterion now: what evidence, by when, makes you stop.",
        "Validate demand before building to avoid the silent-launch trap.",
        "Keep burn low so a wrong guess isn't fatal.",
      ];
    case "low_budget":
      return [
        "Replace anything automated with a manual workaround for v1.",
        "Use a landing page + waitlist to test demand before building.",
        "Spend on validation, not infrastructure.",
      ];
    case "fast":
      return [
        "Time-box to a hard deadline and cut everything off the core path.",
        "Launch to a small, friendly audience first.",
        "Schedule a cleanup pass only after the signal is positive.",
      ];
    case "long_term":
      return [
        "Invest in one owned channel (audience or content) from day one.",
        "Optimize for retention and word-of-mouth over vanity launches.",
        "Set 90-day milestones so 'long-term' never becomes 'never'.",
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

Scores are 0-100. For "risk", HIGHER MEANS SAFER (fewer/smaller risks).

Respond with ONLY a single JSON object (no markdown, no prose) matching exactly:
{
  "scenarioType": string,   // echo the requested scenario id
  "label": string,          // short human label for the scenario
  "narrative": string,      // 2-4 sentences on how this path plays out
  "scores": { "practicality": number, "opportunity": number, "clarity": number, "risk": number },
  "keyFactors": string[],   // 2-4 things that drive this outcome
  "moves": string[]         // 2-4 concrete actions/watch-outs on this path
}`;

function buildScenarioPrompt(input: SimulationInput, base: SimulationReport, type: ScenarioType): string {
  return [
    `Idea: ${input.idea}`,
    input.audience ? `Audience: ${input.audience}` : "",
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
  // Anchor on a deterministic base read so scores stay comparable across scenarios.
  const base = heuristicSimulation(input);
  const config = readLlmConfig();

  if (config) {
    try {
      const report = await llmScenario(input, base, type, config);
      return { report, engine: "llm" };
    } catch (err) {
      console.warn("Genie LLM scenario failed, using heuristic fallback:", err);
    }
  }

  return { report: heuristicScenario(input, base, type), engine: "heuristic" };
}

export async function scenarioFromRaw(raw: unknown): Promise<ScenarioResult> {
  const { scenario, ...input } = scenarioInputSchema.parse(raw);
  return runScenario(input, scenario);
}
