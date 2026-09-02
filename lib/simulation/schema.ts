import { z } from "zod";

/**
 * The structured output of a Genie simulation. Every field is required so the
 * UI can render a complete dashboard without defensive checks. Scores are
 * normalized to 0-100.
 */
export const scoreSchema = z.number().int().min(0).max(100);

export const simulationReportSchema = z.object({
  /** One- or two-sentence restatement of what the user is trying to do. */
  summary: z.string().min(1),
  /** Who the idea is for, concretely. */
  targetUser: z.string().min(1),
  /** How clearly the underlying problem is defined. */
  problemClarity: z.string().min(1),
  /** What makes this different from existing alternatives. */
  differentiation: z.string().min(1),
  /** Read on whether people actually want this. */
  marketDemand: z.string().min(1),
  /** The smallest thing worth building first. */
  mvpSuggestion: z.string().min(1),
  scores: z.object({
    /** Do people want this? */
    desirability: scoreSchema,
    /** Can it realistically be built/delivered? */
    feasibility: scoreSchema,
    /** Is it distinct from existing alternatives? */
    differentiation: scoreSchema,
    /** Higher = safer (lower execution risk). */
    executionRisk: scoreSchema,
    /** Overall confidence in the current model/signals. */
    confidence: scoreSchema,
  }),
  /** The single unverified core assumption that could sink the idea. */
  weakAssumption: z.string().min(1),
  /** The non-coding experiment to run first (e.g. landing page, interviews). */
  experimentDesign: z.string().min(1),
  /** Concrete things that could go wrong. */
  risks: z.array(z.string().min(1)).min(1),
  /** Ordered, practical next moves. */
  nextSteps: z.array(z.string().min(1)).min(1),
  /** The single most important recommendation. */
  recommendation: z.string().min(1),
});

export type SimulationReport = z.infer<typeof simulationReportSchema>;

export const simulationInputSchema = z.object({
  idea: z
    .string()
    .trim()
    .min(8, "Tell Genie a bit more — at least a sentence.")
    .max(4000, "That's a lot. Trim it down to the core idea."),
  /** Intent inputs */
  targetUser: z.string().trim().max(500).optional(),
  goal: z.string().trim().max(500).optional(),
  constraints: z.string().trim().max(500).optional(),
  timeline: z.string().trim().max(200).optional(),
  /** For backwards compatibility / convenience */
  audience: z.string().trim().max(500).optional(),
  /** Optional real-world data / evidence for re-simulation */
  evidence: z.string().trim().max(2000).optional(),
});

export type SimulationInput = z.infer<typeof simulationInputSchema>;

/** Where a report came from — useful for the UI and for tests. */
export type SimulationEngine = "llm" | "heuristic";

export interface SimulationResult {
  report: SimulationReport;
  engine: SimulationEngine;
}
