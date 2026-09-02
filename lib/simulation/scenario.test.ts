import { describe, expect, it } from "vitest";
import { heuristicSimulation } from "./heuristic";
import {
  SCENARIO_TYPES,
  heuristicScenario,
  llmScenario,
  runScenario,
  scenarioInputSchema,
  scenarioReportSchema,
} from "./scenario";
import type { SimulationInput } from "./schema";

const INPUT: SimulationInput = {
  idea: "An AI agent that helps people prepare for job interviews with mock questions.",
  targetUser: "recent CS graduates",
  timeline: "ship an MVP in 3 weeks",
};

const base = () => heuristicSimulation(INPUT);

describe("scenarioInputSchema", () => {
  it("requires a known scenario type", () => {
    expect(scenarioInputSchema.safeParse({ idea: INPUT.idea, scenario: "nope" }).success).toBe(false);
    expect(scenarioInputSchema.safeParse({ idea: INPUT.idea, scenario: "optimistic" }).success).toBe(true);
  });
});

describe("heuristicScenario", () => {
  it("produces a schema-valid report for every scenario type", () => {
    for (const type of SCENARIO_TYPES) {
      const report = heuristicScenario(INPUT, base(), type);
      expect(scenarioReportSchema.safeParse(report).success).toBe(true);
      expect(report.scenarioType).toBe(type);
    }
  });

  it("is deterministic", () => {
    expect(heuristicScenario(INPUT, base(), "realistic")).toEqual(
      heuristicScenario(INPUT, base(), "realistic"),
    );
  });

  it("makes the best case more optimistic than the worst case", () => {
    const best = heuristicScenario(INPUT, base(), "optimistic");
    const worst = heuristicScenario(INPUT, base(), "pessimistic");
    expect(best.scores.desirability).toBeGreaterThan(worst.scores.desirability);
    expect(best.scores.executionRisk).toBeGreaterThan(worst.scores.executionRisk);
  });

  it("makes the cheap MVP path more feasible than the baseline", () => {
    const b = base();
    const cheap = heuristicScenario(INPUT, b, "low_budget");
    expect(cheap.scores.feasibility).toBeGreaterThanOrEqual(b.scores.feasibility);
  });

  it("keeps every score within 0-100", () => {
    for (const type of SCENARIO_TYPES) {
      for (const value of Object.values(heuristicScenario(INPUT, base(), type).scores)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("runScenario", () => {
  it("falls back to the heuristic engine when no LLM is configured", async () => {
    delete process.env.GENIE_LLM_API_KEY;
    const result = await runScenario(INPUT, "fast");
    expect(result.engine).toBe("heuristic");
    expect(result.report.scenarioType).toBe("fast");
  });
});

describe("llmScenario", () => {
  it("calls the endpoint and validates a good response", async () => {
    const report = heuristicScenario(INPUT, base(), "optimistic");
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report) } }] }), {
        status: 200,
      })) as unknown as typeof fetch;

    const result = await llmScenario(INPUT, base(), "optimistic", {
      apiKey: "k",
      baseUrl: "https://x.test/v1",
      model: "m",
    }, fakeFetch);
    expect(result.label).toBe(report.label);
  });

  it("throws on a non-OK response", async () => {
    const fakeFetch = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(
      llmScenario(INPUT, base(), "optimistic", { apiKey: "k", baseUrl: "https://x.test/v1", model: "m" }, fakeFetch),
    ).rejects.toThrow();
  });
});
