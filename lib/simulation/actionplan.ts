import { z } from "zod";
import { bindingConstraint, heuristicSimulation, ideaLabel } from "./heuristic";
import { chatJson, readLlmConfig, type LlmConfig } from "./provider";
import {
  simulationInputSchema,
  type SimulationEngine,
  type SimulationInput,
  type SimulationReport,
} from "./schema";
import { logCompleted, logLlmFailure } from "./telemetry";

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
  const label = ideaLabel(input.idea);
  const user = input.targetUser || input.audience;
  const hasTimeline = Boolean(input.timeline?.trim());
  const lowFeasibility = base.scores.feasibility < 55;
  // Day 1 starts with whatever can kill the idea first (legal check, supply
  // side, willingness to pay, or the hardest component) — see bindingConstraint().
  const binding = bindingConstraint(input);

  const dailyPlan: ActionPlan["dailyPlan"] = [
    { day: 1, ...binding.day1 },
    {
      day: 2,
      focus: "Design and launch the validation experiment",
      tasks: [
        `Experiment design: ${base.experimentDesign}`,
        "Create a simple landing page or survey describing the core value proposition.",
        "Define your success metrics (e.g. 10 signups or 5 completed user interviews).",
      ],
    },
    {
      day: 3,
      focus: "Conduct user interviews and gather real-world data",
      tasks: [
        "Reach out directly to 10 potential target users.",
        "Ask about their current workflow, friction points, and willingness to pay.",
        "Record qualitative responses to test your core hypothesis.",
      ],
    },
    {
      day: 4,
      focus: "Scope the minimal viable build (MVP)",
      tasks: [
        `Define the smallest testable build slice: ${base.mvpSuggestion}`,
        "Explicitly list non-essential features that will NOT be built for v1.",
        lowFeasibility
          ? "Identify technical risks and run a rapid spike on the hardest component."
          : "Choose lightweight tools that allow shipping within days.",
      ],
    },
    {
      day: 5,
      focus: "Build the single core workflow",
      tasks: [
        "Implement only the core value action — bypass auth, settings, and fluff.",
        "Keep backend integrations manual (concierge style) where possible.",
        "Ensure the user flow works smoothly end-to-end.",
      ],
    },
    {
      day: 6,
      focus: "Put the prototype in front of interviewees",
      tasks: [
        "Get the initial prototype into the hands of 3–5 interviewed users.",
        "Observe where users get confused or where value lands.",
        "Collect immediate feedback on usability and perceived value.",
      ],
    },
    {
      day: 7,
      focus: "Feed real data back into Genie and evaluate signal",
      tasks: [
        "Review interview and experiment data against your initial targets.",
        "Re-simulate the idea in Genie with your real-world evidence to update confidence.",
        hasTimeline
          ? `Align the 30-day roadmap with your constraints (${input.timeline!.trim()}).`
          : "Decide whether to proceed with building or pivot based on evidence.",
      ],
    },
  ];

  const roadmap: ActionPlan["roadmap"] = [
    {
      window: "Week 1 (Days 1–7)",
      goal: "Validate core assumption and demand",
      deliverable: "Real-world evidence from experiment & 5+ user interviews.",
    },
    {
      window: "Week 2",
      goal: "Build thinnest MVP slice",
      deliverable: "Working end-to-end prototype of the core user action.",
    },
    {
      window: "Week 3",
      goal: "Deploy to initial pilot cohort",
      deliverable: "10 active users testing the prototype and sharing feedback.",
    },
    {
      window: "Week 4",
      goal: "Evaluate metrics & make final Build / Pivot decision",
      deliverable: "Data-backed decision roadmap for full product rollout.",
    },
  ];

  const buildChecklist = [
    "Define the single primary action the MVP delivers.",
    "Explicitly document features deferred to post-MVP.",
    lowFeasibility
      ? "Spike the primary technical risk before writing UI code."
      : "Use off-the-shelf tools to accelerate shipping.",
    "Build a clean end-to-end path with minimal infrastructure.",
    "Add basic analytics to measure core user activation.",
  ];

  const validationChecklist = [
    `Test weak assumption: "${base.weakAssumption}".`,
    "Run landing page or user interview experiment before building complex features.",
    "Establish clear numerical thresholds for validating demand.",
    "Test willingness to pay with direct pricing discussions or deposits.",
    "Log evidence into Genie to re-simulate updated confidence.",
  ];

  const overview = hasTimeline
    ? `A validation-first sprint for ${label}, framed against your timeline (${input.timeline!.trim()}). Week one collects real-world data before building.`
    : `A validation-first 30-day roadmap for ${label}. Week one collects real-world data before building.`;

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
  const user = input.targetUser || input.audience;
  return [
    `Idea: ${input.idea}`,
    user ? `Target User: ${user}` : "",
    input.timeline ? `Timeline: ${input.timeline}` : "",
    `\nBaseline analysis (for context):`,
    JSON.stringify({
      summary: base.summary,
      weakAssumption: base.weakAssumption,
      experimentDesign: base.experimentDesign,
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
  const startedAt = Date.now();

  if (config) {
    try {
      const report = await llmActionPlan(input, base, config);
      logCompleted("actionplan", "llm", true, startedAt);
      return { report, engine: "llm" };
    } catch (err) {
      logLlmFailure("actionplan", err);
    }
  }

  const result: ActionPlanResult = { report: heuristicActionPlan(input, base), engine: "heuristic" };
  logCompleted("actionplan", "heuristic", Boolean(config), startedAt);
  return result;
}

export async function actionPlanFromRaw(raw: unknown): Promise<ActionPlanResult> {
  const input = simulationInputSchema.parse(raw);
  return runActionPlan(input);
}
