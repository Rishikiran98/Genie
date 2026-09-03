import { heuristicSimulation } from "./heuristic";
import { llmSimulation, readLlmConfig } from "./provider";
import { simulationInputSchema, type SimulationInput, type SimulationResult } from "./schema";
import { logCompleted, logLlmFailure } from "./telemetry";

/**
 * Runs a simulation for a validated input.
 *
 * Strategy:
 *   1. If an LLM is configured, try it.
 *   2. If the LLM fails for any reason (network, bad output, no key), fall back
 *      to the deterministic heuristic engine so the user always gets a report.
 *
 * The returned `engine` field records which path produced the report, which the
 * UI surfaces so users know whether they're seeing an LLM or offline analysis.
 */
export async function runSimulation(input: SimulationInput): Promise<SimulationResult> {
  const config = readLlmConfig();
  const startedAt = Date.now();

  if (config) {
    try {
      const report = await llmSimulation(input, config);
      logCompleted("simulate", "llm", true, startedAt);
      return { report, engine: "llm" };
    } catch (err) {
      // Soft-fail to the heuristic engine; never leave the user empty-handed.
      logLlmFailure("simulate", err);
    }
  }

  const result: SimulationResult = { report: heuristicSimulation(input), engine: "heuristic" };
  logCompleted("simulate", "heuristic", Boolean(config), startedAt);
  return result;
}

/** Parses + validates raw input, then runs the simulation. Throws ZodError on bad input. */
export async function simulateFromRaw(raw: unknown): Promise<SimulationResult> {
  const input: SimulationInput = simulationInputSchema.parse(raw);
  return runSimulation(input);
}
