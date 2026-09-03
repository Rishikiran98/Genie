import { describe, expect, it } from "vitest";
import { analyzeConstraints, heuristicSimulation } from "./heuristic";
import type { SimulationInput } from "./schema";

/**
 * The reference failure from the output-quality work: a regulated, two-sided,
 * cold-start marketplace run solo on $2,000 with no evidence. Every scoring
 * rule is checked against this case and against a plain B2B SaaS idea.
 */
export const MARKETPLACE: SimulationInput = {
  idea: "Marketplace where local home cooks sell fresh homemade meals to nearby busy professionals for pickup or delivery",
  targetUser: "Busy professionals who regularly order food",
  goal: "Test demand, repeat purchases, and marketplace viability",
  constraints: "$2,000 budget, solo founder, one neighborhood, food regulations",
  timeline: "4-week validation sprint",
};

export const SAAS: SimulationInput = {
  idea: "A B2B SaaS dashboard that helps small accounting firms track client document requests and deadlines in one place",
  targetUser: "Owners of 5-20 person accounting firms",
  goal: "Get 10 paying firms at $49/month",
  timeline: "6 weeks",
};

describe("analyzeConstraints", () => {
  it("parses the reference constraints into severity signals with the user's words", () => {
    const c = analyzeConstraints(MARKETPLACE);
    expect(c.budgetUsd).toBe(2000);
    expect(c.budgetSeverity).toBe(2);
    expect(c.budgetQuote).toBe("$2,000 budget");
    expect(c.soloFounder).toBe(true);
    expect(c.soloQuote).toBe("solo founder");
    expect(c.singleMarket).toBe(true);
    expect(c.singleMarketQuote).toBe("one neighborhood");
    expect(c.regulatoryQuote).toBe("food regulations");
  });

  it("distinguishes budget magnitudes", () => {
    const at = (constraints: string) => analyzeConstraints({ idea: MARKETPLACE.idea, constraints });
    expect(at("$200,000 budget").budgetSeverity).toBe(0);
    expect(at("$200k budget, two engineers").budgetSeverity).toBe(0);
    expect(at("$15k budget").budgetSeverity).toBe(1);
    expect(at("$500 budget").budgetSeverity).toBe(2);
    expect(at("no budget, evenings and weekends").budgetSeverity).toBe(2);
    expect(at("must ship in Q3").budgetSeverity).toBe(0);
  });

  it("detects regulatory language in the idea when the constraints are silent", () => {
    const c = analyzeConstraints({ idea: "A HIPAA-compliant app that lets patients share records with new doctors" });
    expect(c.regulatoryQuote?.toLowerCase()).toContain("hipaa");
  });

  it("returns empty signals when no constraints are given", () => {
    const c = analyzeConstraints(SAAS);
    expect(c).toMatchObject({ budgetSeverity: 0, soloFounder: false, singleMarket: false, regulatoryQuote: null });
  });
});

describe("constraints cost something", () => {
  const withConstraints = heuristicSimulation(MARKETPLACE);
  const withoutConstraints = heuristicSimulation({ ...MARKETPLACE, constraints: undefined });

  it("lowers feasibility and execution-risk safety for the reference input", () => {
    expect(withConstraints.scores.feasibility).toBeLessThan(withoutConstraints.scores.feasibility);
    expect(withConstraints.scores.executionRisk).toBeLessThan(withoutConstraints.scores.executionRisk);
    // Visibly, not marginally.
    expect(withoutConstraints.scores.feasibility - withConstraints.scores.feasibility).toBeGreaterThanOrEqual(15);
    expect(withoutConstraints.scores.executionRisk - withConstraints.scores.executionRisk).toBeGreaterThanOrEqual(15);
  });

  it("puts a regulatory risk line first, quoting the user's constraint", () => {
    expect(withConstraints.risks[0]).toMatch(/regulat/i);
    expect(withConstraints.risks[0]).toContain('"food regulations"');
  });

  it("emits one risk line per detected constraint", () => {
    const joined = withConstraints.risks.join("\n");
    expect(joined).toContain('"$2,000 budget"');
    expect(joined).toContain('"solo founder"');
    expect(joined).toContain('"one neighborhood"');
  });

  it("does not penalise a mild constraint like a deadline", () => {
    const base = heuristicSimulation(SAAS);
    const mild = heuristicSimulation({ ...SAAS, constraints: "must ship before the tax season" });
    expect(mild.scores.feasibility).toBe(base.scores.feasibility);
    expect(mild.scores.executionRisk).toBe(base.scores.executionRisk);
    expect(mild.scores.confidence).toBeGreaterThanOrEqual(base.scores.confidence);
  });
});
