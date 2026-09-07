import { describe, expect, it } from "vitest";
import { analyzeConstraints, bindingConstraint, heuristicSimulation } from "./heuristic";
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

describe("desirability measures evidence, not vocabulary", () => {
  it("lands the reference input in a defensible band without evidence", () => {
    const { scores } = heuristicSimulation(MARKETPLACE);
    expect(scores.desirability).toBeGreaterThanOrEqual(55);
    expect(scores.desirability).toBeLessThanOrEqual(70);
    expect(scores.confidence).toBeLessThanOrEqual(55);
  });

  it("caps desirability and confidence whenever no evidence is supplied", () => {
    // Every commercial word and every optional field filled in, still no evidence.
    const loaded = heuristicSimulation({
      idea: "A subscription SaaS for paying customers with clear market demand, revenue and growth, priced at $49 per month",
      targetUser: "Marketing teams at mid-size companies",
      goal: "Reach $10k MRR",
      constraints: "6 weeks",
      timeline: "6 weeks",
    });
    expect(loaded.scores.desirability).toBeLessThanOrEqual(70);
    expect(loaded.scores.confidence).toBeLessThanOrEqual(55);
  });

  it("raises both desirability and confidence when evidence is added", () => {
    const base = heuristicSimulation(MARKETPLACE);
    const withEvidence = heuristicSimulation({
      ...MARKETPLACE,
      evidence: "Interviewed 12 professionals in the neighborhood; 9 pre-paid $15 for a first meal and 6 cooks signed up.",
    });
    expect(withEvidence.scores.desirability).toBeGreaterThan(base.scores.desirability);
    expect(withEvidence.scores.confidence).toBeGreaterThan(base.scores.confidence);
    // Evidence is what unlocks scores above the ceilings.
    expect(withEvidence.scores.desirability).toBeGreaterThan(70);
    expect(withEvidence.scores.confidence).toBeGreaterThan(55);
  });

  it("does not let commerce nouns move desirability by more than a few points", () => {
    const plain = heuristicSimulation({ ...SAAS, idea: "A dashboard that helps small accounting firms track client document requests and deadlines" });
    const wordy = heuristicSimulation({
      ...SAAS,
      idea: "A dashboard that helps small accounting firms (our customers) track client document requests — a market with demand, revenue and growth we can sell into",
    });
    expect(wordy.scores.desirability - plain.scores.desirability).toBeLessThanOrEqual(5);
  });

  it("applies a cold-start penalty to two-sided ideas", () => {
    const oneSided = heuristicSimulation({ idea: "An app where busy professionals order fresh homemade meals from our kitchen", targetUser: "Busy professionals" });
    const twoSided = heuristicSimulation({ idea: "A marketplace where home cooks sell fresh homemade meals to busy professionals", targetUser: "Busy professionals" });
    expect(twoSided.scores.desirability).toBeLessThan(oneSided.scores.desirability);
    expect(twoSided.risks.join(" ")).toMatch(/cold start/i);
  });

  it("does not treat a budget figure in the constraints as pricing", () => {
    const withBudget = heuristicSimulation({ ...SAAS, goal: "Get 10 firms using it", constraints: "$2,000 budget" });
    const without = heuristicSimulation({ ...SAAS, goal: "Get 10 firms using it" });
    expect(withBudget.scores.desirability).toBeLessThanOrEqual(without.scores.desirability);
  });
});

describe("the report only asserts what it was told", () => {
  it("says plainly when no differentiation was stated", () => {
    const report = heuristicSimulation(MARKETPLACE);
    expect(report.differentiation).toMatch(/no differentiation .* was stated/i);
    expect(report.differentiation).not.toMatch(/clear differentiation/i);
    expect(report.scores.differentiation).toBeLessThanOrEqual(50);
  });

  it("credits differentiation that the input actually expresses", () => {
    const report = heuristicSimulation({
      ...SAAS,
      idea: "Unlike existing practice-management suites, a single-purpose tracker for client document requests that accountants can set up in ten minutes",
    });
    expect(report.differentiation).toMatch(/stated differentiation/i);
    expect(report.differentiation).toContain("Unlike existing practice-management suites");
    expect(report.scores.differentiation).toBeGreaterThan(50);
  });

  it("describes what the input contains instead of asserting the problem is real", () => {
    const report = heuristicSimulation(SAAS);
    expect(report.problemClarity).not.toMatch(/is clear and addresses/i);
    expect(report.problemClarity).toMatch(/names who it is for/i);
    expect(report.problemClarity).toMatch(/assumption|unverified/i);
  });

  it("never calls demand validated without evidence", () => {
    const report = heuristicSimulation(MARKETPLACE);
    expect(report.marketDemand).toMatch(/no demand evidence/i);
    expect(report.marketDemand).not.toMatch(/validated/i);
    expect(report.recommendation).not.toMatch(/proceed with building|high signal/i);
    expect(report.summary).toMatch(/no evidence/i);
  });

  it("quotes the evidence rather than declaring the idea validated", () => {
    const report = heuristicSimulation({ ...SAAS, evidence: "3 firms pre-paid for a pilot" });
    expect(report.marketDemand).toContain("3 firms pre-paid for a pilot");
    expect(report.marketDemand).not.toMatch(/^validated/i);
  });
});

describe("the binding constraint leads", () => {
  it("is the legal question for the reference input, and every advisory field addresses it", () => {
    expect(bindingConstraint(MARKETPLACE).kind).toBe("regulatory");
    const report = heuristicSimulation(MARKETPLACE);
    expect(report.experimentDesign).toMatch(/legal|jurisdiction/i);
    expect(report.experimentDesign).not.toMatch(/landing page/i);
    expect(report.weakAssumption).toContain('"food regulations"');
    expect(report.recommendation).toMatch(/legal|regulat/i);
    expect(report.recommendation).toMatch(/do not build/i);
    expect(report.nextSteps[0]).toMatch(/legal/i);
  });

  it("chains to the next blocker after the legal question for a two-sided idea", () => {
    const report = heuristicSimulation(MARKETPLACE);
    expect(report.recommendation).toMatch(/next blocker is the supply-side cold start/i);
  });

  it("is the supply side for an unregulated marketplace", () => {
    const input: SimulationInput = { idea: "A marketplace where retired teachers sell one-off tutoring sessions to parents", targetUser: "Parents of high-schoolers" };
    expect(bindingConstraint(input).kind).toBe("cold_start");
    expect(heuristicSimulation(input).experimentDesign).toMatch(/supply side/i);
  });

  it("keeps the demand-first path for a plain B2B SaaS idea", () => {
    expect(bindingConstraint(SAAS).kind).toBe("willingness_to_pay");
    const report = heuristicSimulation(SAAS);
    expect(report.experimentDesign).toMatch(/deposit|pre-order|pay/i);
    expect(report.experimentDesign).not.toMatch(/legal|jurisdiction/i);
  });

  it("moves to feasibility once paid evidence exists", () => {
    expect(bindingConstraint({ ...SAAS, evidence: "4 firms pre-paid $49 for month one" }).kind).toBe("feasibility");
  });
});
