import { z } from "zod";

/**
 * The structured output of a Genie simulation. Every field is required so the
 * UI can render a complete dashboard without defensive checks. Scores are
 * normalized to 0-100 (higher is better, including `risk` where a higher score
 * means *lower* risk, so all four scores read "green = good").
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
    practicality: scoreSchema,
    opportunity: scoreSchema,
    clarity: scoreSchema,
    /** Higher = safer (fewer/less severe risks). */
    risk: scoreSchema,
  }),
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
  /** Optional context the user can volunteer up front. */
  audience: z.string().trim().max(500).optional(),
  timeline: z.string().trim().max(200).optional(),
});

export type SimulationInput = z.infer<typeof simulationInputSchema>;

/** Where a report came from — useful for the UI and for tests. */
export type SimulationEngine = "llm" | "heuristic";

export interface SimulationResult {
  report: SimulationReport;
  engine: SimulationEngine;
}
