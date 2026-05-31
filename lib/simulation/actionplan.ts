import { z } from "zod";
import { heuristicSimulation, shortTopic } from "./heuristic";
import { chatJson, readLlmConfig, type LlmConfig } from "./provider";
import {
  simulationInputSchema,
  type SimulationEngine,
  type SimulationInput,
  type SimulationReport,
} from "./schema";

/**
 * Action plan generator: turn a simulation into something you can act on
 * tomorrow — a day-by-day first week, a 4-week roadmap, and build/validation
 * checklists. The plan is validation-first by design: week one is about
 * evidence, not code.
 */

export const actionPlanSchema = z.object({
  /** One-paragraph framing of the plan. */
  overview: z.string().min(1),
  /** A concrete Day 1 → Day 7 plan. */
  dailyPlan: z
    .array(
      z.object({
        day: z.number().int().min(1).max(7),
        focus: z.string().min(1),
        tasks: z.array(z.string().min(1)).min(1),
      }),
    )
    .length(7),
  /** A ~30-day, week-by-week roadmap. */
  roadmap: z
    .array(
      z.object({
        window: z.string().min(1),
        goal: z.string().min(1),
        deliverable: z.string().min(1),
      }),
    )
    .min(1),
  buildChecklist: z.array(z.string().min(1)).min(1),
  validationChecklist: z.array(z.string().min(1)).min(1),
});

export type ActionPlan = z.infer<typeof actionPlanSchema>;

export interface ActionPlanResult {
  report: ActionPlan;
  engine: SimulationEngine;
}

// ---------------------------------------------------------------------------
// Heuristic action plan
// ---------------------------------------------------------------------------

export function heuristicActionPlan(input: SimulationInput, base: SimulationReport): ActionPlan {
  const topic = shortTopic(input.idea);
  const hasAudience = Boolean(input.audience?.trim());
  const hasTimeline = Boolean(input.timeline?.trim());
  const lowClarity = base.scores.clarity < 50;
  const lowPracticality = base.scores.practicality < 50;

  const dailyPlan: ActionPlan["dailyPlan"] = [
    {
      day: 1,
      focus: "Sharpen the problem and pick your first user",
      tasks: [
        lowClarity
          ? "Write the problem you're solving in one concrete sentence — the painful, recurring situation."
          : "Restate the core problem in one sentence and confirm people actively try to solve it today.",
        hasAudience
          ? `Profile one specific first user within "${input.audience!.trim()}" that you can actually reach.`
          : "Pick ONE narrow first user you can reach this week — avoid 'everyone'.",
        "List the alternatives they use today, including doing nothing.",
      ],
    },
    {
      day: 2,
      focus: "Talk to real people before building",
      tasks: [
        "Line up 5–10 short conversations with potential users.",
        "Ask about their current workaround and what it costs them — don't pitch.",
        "Capture verbatim quotes; look for repeated pain, not polite interest.",
      ],
    },
    {
      day: 3,
      focus: "Scope the thinnest MVP",
      tasks: [
        `Define the single core action the MVP must nail. Genie's suggestion: ${base.mvpSuggestion}`,
        "Write down what you will NOT build for v1.",
        lowPracticality
          ? "Identify the hardest technical unknown and plan to spike it first."
          : "Choose the simplest tools/stack that can ship this in days.",
      ],
    },
    {
      day: 4,
      focus: "Build a fake door to test demand",
      tasks: [
        "Put up a one-page landing site describing the value with a clear call to action.",
        "Add a waitlist or 'notify me' capture.",
        "Define your success threshold (e.g. X signups or Y% conversion).",
      ],
    },
    {
      day: 5,
      focus: "Drive a first trickle of real traffic",
      tasks: [
        "Share the landing page in 2–3 places your target users already gather.",
        "Personally message 10 potential users with a short, specific note.",
        "Track signups against your threshold.",
      ],
    },
    {
      day: 6,
      focus: "Prototype the core action — rough is fine",
      tasks: [
        "Implement only the one core action end-to-end; skip auth, settings, and polish.",
        lowPracticality
          ? "Spike the riskiest part first to prove it's feasible."
          : "Keep it manual/concierge wherever automation isn't essential yet.",
        "Get a single happy path working.",
      ],
    },
    {
      day: 7,
      focus: "Review the signal and decide",
      tasks: [
        "Compare results to your success threshold honestly.",
        "Decide: double down, iterate the positioning, or kill it.",
        hasTimeline
          ? `Re-plan the next sprint against your stated timeline (${input.timeline!.trim()}).`
          : "Set the next one-week milestone with a clear success metric.",
      ],
    },
  ];

  const roadmap: ActionPlan["roadmap"] = [
    {
      window: "Week 1 (Days 1–7)",
      goal: "Validate the problem and demand",
      deliverable: "Evidence from 5+ user conversations and a live landing page with early signups.",
    },
    {
      window: "Week 2",
      goal: "Build the thinnest MVP slice",
      deliverable: "The one core action working end-to-end for a single happy path.",
    },
    {
      window: "Week 3",
      goal: "Put the MVP in front of real users",
      deliverable: "5–10 people have used it and structured feedback is collected.",
    },
    {
      window: "Week 4",
      goal: "Iterate and decide on investment",
      deliverable: "A go / iterate / kill decision backed by usage data and a refined next plan.",
    },
  ];

  const buildChecklist = [
    "Define the one core user action the MVP must deliver.",
    "List what you're explicitly NOT building for v1.",
    lowPracticality
      ? "De-risk the hardest technical unknown with a quick spike."
      : "Pick the simplest stack/tools that can ship in days.",
    "Build the single happy path first — no auth, no settings, no polish.",
    "Instrument basic usage tracking for the core action.",
  ];

  const validationChecklist = [
    "Talk to at least 5 target users about the problem, not the product.",
    "Landing page + waitlist live with a clear call to action.",
    "Define a success metric and the threshold that means 'keep going'.",
    "Test willingness to pay with at least a rough pricing hypothesis.",
    "Write down a kill criterion: what evidence, by when, would make you stop.",
  ];

  const overview = hasTimeline
    ? `A validation-first sprint for "${topic}", framed against your timeline (${input.timeline!.trim()}). Week one buys evidence, not code — confirm people want this before building it.`
    : `A validation-first 4-week sprint for "${topic}". Week one buys evidence, not code — confirm people want this before building it.`;

  return { overview, dailyPlan, roadmap, buildChecklist, validationChecklist };
}

// ---------------------------------------------------------------------------
// LLM action plan
// ---------------------------------------------------------------------------

const ACTION_PLAN_SYSTEM_PROMPT = `You are Genie, a decision and idea simulation engine.
Given an idea and its baseline analysis, produce a concrete, validation-first
execution plan. Be specific and practical — every task should be something the
user can actually do. Prefer evidence before code in the first week.

Respond with ONLY a single JSON object (no markdown, no prose) matching exactly:
{
  "overview": string,                       // one-paragraph framing of the plan
  "dailyPlan": [                            // EXACTLY 7 entries, day 1 through 7
    { "day": number, "focus": string, "tasks": string[] }
  ],
  "roadmap": [                              // 3-4 week-by-week milestones
    { "window": string, "goal": string, "deliverable": string }
  ],
  "buildChecklist": string[],               // 3-6 concrete build items
  "validationChecklist": string[]           // 3-6 concrete validation items
}`;

function buildActionPlanPrompt(input: SimulationInput, base: SimulationReport): string {
  return [
    `Idea: ${input.idea}`,
    input.audience ? `Audience: ${input.audience}` : "",
    input.timeline ? `Timeline: ${input.timeline}` : "",
    `\nBaseline analysis (for context):`,
    JSON.stringify({
      summary: base.summary,
      mvpSuggestion: base.mvpSuggestion,
      nextSteps: base.nextSteps,
      risks: base.risks,
      scores: base.scores,
    }),
    `\nProduce the execution plan. Day 1-7 must have exactly 7 entries. Return the JSON object only.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function llmActionPlan(
  input: SimulationInput,
  base: SimulationReport,
  config: LlmConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ActionPlan> {
  const raw = await chatJson(config, ACTION_PLAN_SYSTEM_PROMPT, buildActionPlanPrompt(input, base), fetchImpl);
  return actionPlanSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function runActionPlan(input: SimulationInput): Promise<ActionPlanResult> {
  const base = heuristicSimulation(input);
  const config = readLlmConfig();

  if (config) {
    try {
      const report = await llmActionPlan(input, base, config);
      return { report, engine: "llm" };
    } catch (err) {
      console.warn("Genie LLM action plan failed, using heuristic fallback:", err);
    }
  }

  return { report: heuristicActionPlan(input, base), engine: "heuristic" };
}

export async function actionPlanFromRaw(raw: unknown): Promise<ActionPlanResult> {
  const input = simulationInputSchema.parse(raw);
  return runActionPlan(input);
}
