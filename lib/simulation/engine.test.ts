import { describe, expect, it } from "vitest";
import { heuristicSimulation } from "./heuristic";
import { runSimulation } from "./engine";
import { extractJson, llmSimulation, readLlmConfig } from "./provider";
import { simulationInputSchema, simulationReportSchema } from "./schema";
import type { SimulationInput } from "./schema";

const idea = (overrides: Partial<SimulationInput> = {}): SimulationInput => ({
  idea: "An AI agent that helps people prepare for interviews with mock questions.",
  ...overrides,
});

describe("input validation", () => {
  it("rejects ideas that are too short", () => {
    expect(simulationInputSchema.safeParse({ idea: "hi" }).success).toBe(false);
  });

  it("trims and accepts a real idea", () => {
    const parsed = simulationInputSchema.parse({ idea: "  Build a budgeting app for freelancers  " });
    expect(parsed.idea).toBe("Build a budgeting app for freelancers");
  });
});

describe("heuristicSimulation", () => {
  it("produces a schema-valid report", () => {
    const report = heuristicSimulation(idea());
    expect(simulationReportSchema.safeParse(report).success).toBe(true);
  });

  it("is deterministic for the same input", () => {
    expect(heuristicSimulation(idea())).toEqual(heuristicSimulation(idea()));
  });

  it("keeps every score within 0-100", () => {
    const { scores } = heuristicSimulation(idea());
    for (const value of Object.values(scores)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it("rewards explicit evidence with higher confidence", () => {
    const base = heuristicSimulation(idea());
    const withEvidence = heuristicSimulation(idea({ evidence: "Interviewed 10 users, 8 signed up on waitlist." }));
    expect(withEvidence.scores.confidence).toBeGreaterThan(base.scores.confidence);
  });

  it("flags a missing target user as a risk", () => {
    const report = heuristicSimulation({ idea: "A platform that does many useful things for many people." });
    expect(report.risks.join(" ").toLowerCase()).toContain("user");
  });

  it("treats high-complexity domains as carrying higher execution risk", () => {
    const hardware = heuristicSimulation({ idea: "A hardware IoT sensor device for smart farming on real farms." });
    const content = heuristicSimulation({ idea: "A weekly newsletter and blog about cooking for busy parents." });
    expect(hardware.scores.executionRisk).toBeLessThan(content.scores.executionRisk);
  });

  it("includes a weak assumption and experiment design", () => {
    const report = heuristicSimulation(idea());
    expect(report.weakAssumption.length).toBeGreaterThan(0);
    expect(report.experimentDesign.length).toBeGreaterThan(0);
  });
});

describe("runSimulation", () => {
  it("falls back to the heuristic engine when no LLM is configured", async () => {
    delete process.env.GENIE_LLM_API_KEY;
    const result = await runSimulation(idea());
    expect(result.engine).toBe("heuristic");
    expect(simulationReportSchema.safeParse(result.report).success).toBe(true);
  });
});

describe("provider helpers", () => {
  it("reads config only when an API key is present", () => {
    expect(readLlmConfig({})).toBeNull();
    const config = readLlmConfig({ GENIE_LLM_API_KEY: "sk-test" });
    expect(config).toMatchObject({ apiKey: "sk-test", baseUrl: "https://api.openai.com/v1" });
  });

  it("strips a trailing slash from the base url", () => {
    const config = readLlmConfig({ GENIE_LLM_API_KEY: "k", GENIE_LLM_BASE_URL: "https://x.test/v1/" });
    expect(config?.baseUrl).toBe("https://x.test/v1");
  });

  it("extracts JSON from a fenced code block", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("extracts JSON surrounded by prose", () => {
    expect(extractJson('Sure! {"a":2} hope that helps')).toEqual({ a: 2 });
  });

  it("throws when no JSON object is present", () => {
    expect(() => extractJson("no json here")).toThrow();
  });

  it("calls the endpoint and validates a good response", async () => {
    const report = heuristicSimulation(idea());
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report) } }] }), {
        status: 200,
      })) as unknown as typeof fetch;

    const result = await llmSimulation(idea(), { apiKey: "k", baseUrl: "https://x.test/v1", model: "m" }, fakeFetch);
    expect(result.summary).toBe(report.summary);
  });

  it("throws on a non-OK response", async () => {
    const fakeFetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(
      llmSimulation(idea(), { apiKey: "k", baseUrl: "https://x.test/v1", model: "m" }, fakeFetch),
    ).rejects.toThrow();
  });
});
