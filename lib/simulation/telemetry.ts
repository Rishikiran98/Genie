import { log, serializeError } from "../log";
import { classifyLlmError, LlmError } from "./provider";
import type { SimulationEngine } from "./schema";

/**
 * Log helpers shared by the engine dispatchers. Two events matter:
 *
 *   llm.failed           — one per LLM call that fell back, with `errorKind`
 *   simulation.completed — one per request, with `engine` and `fallback`
 *
 * Fallback rate = completed events with `fallback:true` ÷ completed events
 * with `llmConfigured:true` (see docs/OPERATIONS.md for the exact recipe).
 */

export type Feature = "simulate" | "scenario" | "actionplan";

/** Records an LLM failure that is about to be masked by the heuristic fallback. */
export function logLlmFailure(feature: Feature, err: unknown): void {
  const { name, message } = serializeError(err);
  log.warn("llm.failed", {
    feature,
    errorKind: classifyLlmError(err),
    status: err instanceof LlmError ? err.status : undefined,
    errorName: name,
    message,
  });
}

/** Records which engine answered and whether that was a silent fallback. */
export function logCompleted(feature: Feature, engine: SimulationEngine, llmConfigured: boolean, startedAt: number): void {
  log.info("simulation.completed", {
    feature,
    engine,
    llmConfigured,
    fallback: llmConfigured && engine === "heuristic",
    durationMs: Date.now() - startedAt,
  });
}
