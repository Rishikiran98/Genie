import { describe, expect, it } from "vitest";
import { heuristicSimulation } from "./heuristic";
import {
  actionPlanSchema,
  heuristicActionPlan,
  llmActionPlan,
  runActionPlan,
} from "./actionplan";
import type { SimulationInput } from "./schema";

const INPUT: SimulationInput = {
  idea: "An AI agent that helps people prepare for job interviews with mock questions.",
  audience: "recent CS graduates",
  timeline: "ship an MVP in 3 weeks",
};

const base = () => heuristicSimulation(INPUT);

describe("heuristicActionPlan", () => {
  it("produces a schema-valid plan", () => {
    expect(actionPlanSchema.safeParse(heuristicActionPlan(INPUT, base())).success).toBe(true);
  });

  it("covers exactly day 1 through day 7", () => {
    const plan = heuristicActionPlan(INPUT, base());
    expect(plan.dailyPlan.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const d of plan.dailyPlan) expect(d.tasks.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    expect(heuristicActionPlan(INPUT, base())).toEqual(heuristicActionPlan(INPUT, base()));
  });

  it("provides non-empty build and validation checklists", () => {
    const plan = heuristicActionPlan(INPUT, base());
    expect(plan.buildChecklist.length).toBeGreaterThan(0);
    expect(plan.validationChecklist.length).toBeGreaterThan(0);
  });

  it("references the stated timeline in the overview", () => {
    expect(heuristicActionPlan(INPUT, base()).overview).toContain("3 weeks");
  });

  it("uses the audience on day 1 when one is given", () => {
    const plan = heuristicActionPlan(INPUT, base());
    expect(plan.dailyPlan[0].tasks.join(" ")).toContain("recent CS graduates");
  });

  it("tells a vague idea to define the problem in one sentence", () => {
    const vagueInput = { idea: "I want to build something cool, maybe an app of some kind." };
    const plan = heuristicActionPlan(vagueInput, heuristicSimulation(vagueInput));
    expect(plan.dailyPlan[0].tasks.join(" ").toLowerCase()).toContain("one concrete sentence");
  });
});

describe("runActionPlan", () => {
  it("falls back to the heuristic engine when no LLM is configured", async () => {
    delete process.env.GENIE_LLM_API_KEY;
    const result = await runActionPlan(INPUT);
    expect(result.engine).toBe("heuristic");
    expect(result.report.dailyPlan).toHaveLength(7);
  });
});

describe("llmActionPlan", () => {
  it("calls the endpoint and validates a good response", async () => {
    const plan = heuristicActionPlan(INPUT, base());
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }), {
        status: 200,
      })) as unknown as typeof fetch;

    const result = await llmActionPlan(INPUT, base(), { apiKey: "k", baseUrl: "https://x.test/v1", model: "m" }, fakeFetch);
    expect(result.overview).toBe(plan.overview);
  });

  it("rejects a plan that doesn't have 7 days", async () => {
    const plan = heuristicActionPlan(INPUT, base());
    const broken = { ...plan, dailyPlan: plan.dailyPlan.slice(0, 3) };
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(broken) } }] }), {
        status: 200,
      })) as unknown as typeof fetch;

    await expect(
      llmActionPlan(INPUT, base(), { apiKey: "k", baseUrl: "https://x.test/v1", model: "m" }, fakeFetch),
    ).rejects.toThrow();
  });
});

describe("day 1 starts with the binding constraint", () => {
  const MARKETPLACE: SimulationInput = {
    idea: "Marketplace where local home cooks sell fresh homemade meals to nearby busy professionals for pickup or delivery",
    targetUser: "Busy professionals who regularly order food",
    goal: "Test demand, repeat purchases, and marketplace viability",
    constraints: "$2,000 budget, solo founder, one neighborhood, food regulations",
    timeline: "4-week validation sprint",
  };

  it("is a legality check for the regulated marketplace", () => {
    const plan = heuristicActionPlan(MARKETPLACE, heuristicSimulation(MARKETPLACE));
    expect(plan.dailyPlan[0].focus).toMatch(/legal/i);
    expect(plan.dailyPlan[0].tasks.join(" ")).toContain('"food regulations"');
  });

  it("stays demand-first for a plain B2B SaaS idea", () => {
    const saas: SimulationInput = {
      idea: "A B2B SaaS dashboard that helps small accounting firms track client document requests and deadlines in one place",
      targetUser: "Owners of 5-20 person accounting firms",
      goal: "Get 10 paying firms at $49/month",
    };
    const plan = heuristicActionPlan(saas, heuristicSimulation(saas));
    expect(plan.dailyPlan[0].focus).toMatch(/sharpen the problem/i);
    expect(plan.dailyPlan[0].tasks.join(" ")).not.toMatch(/legal/i);
  });
});
