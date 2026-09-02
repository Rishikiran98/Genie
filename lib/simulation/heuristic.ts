import type { SimulationInput, SimulationReport } from "./schema";

/**
 * A deterministic, offline simulation engine.
 *
 * Inspects the idea and intent inputs for concrete signals (target user, goal,
 * constraints, timeline, evidence, vague language, high-complexity domains)
 * and turns them into a structured, scored report. Determinism is the point:
 * the app runs with zero credentials and the output is stable enough to assert on in tests.
 */

const clamp = (n: number): number => Math.max(5, Math.min(95, Math.round(n)));

const VAGUE_WORDS = [
  "something",
  "somehow",
  "maybe",
  "kind of",
  "sort of",
  "stuff",
  "things",
  "etc",
  "whatever",
  "i guess",
];

const MARKET_WORDS = [
  "market",
  "customer",
  "customers",
  "users",
  "demand",
  "pay",
  "paying",
  "revenue",
  "sell",
  "growth",
];

const MVP_WORDS = ["mvp", "prototype", "simple", "landing page", "waitlist", "demo", "interview"];

const DOMAINS: { name: string; keywords: string[]; complexity: number }[] = [
  { name: "hardware", keywords: ["hardware", "device", "robot", "iot", "sensor"], complexity: 22 },
  { name: "blockchain", keywords: ["blockchain", "crypto", "web3", "token", "nft"], complexity: 20 },
  { name: "marketplace", keywords: ["marketplace", "two-sided", "buyers and sellers", "platform connecting"], complexity: 16 },
  { name: "AI", keywords: ["ai", "agent", "llm", "machine learning", "ml model", "gpt"], complexity: 9 },
  { name: "mobile app", keywords: ["mobile app", "ios", "android"], complexity: 8 },
  { name: "SaaS", keywords: ["saas", "dashboard", "b2b", "subscription"], complexity: 6 },
  { name: "content", keywords: ["content", "newsletter", "blog", "video", "course"], complexity: 4 },
];

const PRICING_WORDS = ["$", "subscription", "charge", "pricing", "per month", "/month", "free tier", "freemium"];

interface Signals {
  text: string;
  wordCount: number;
  hasAudience: boolean;
  hasGoal: boolean;
  hasConstraints: boolean;
  hasTimeline: boolean;
  hasPricing: boolean;
  hasEvidence: boolean;
  evidenceText: string;
  vagueHits: number;
  marketHits: number;
  mvpHits: number;
  domains: { name: string; complexity: number }[];
  totalComplexity: number;
}

function countHits(text: string, words: string[]): number {
  return words.reduce((acc, w) => (text.includes(w) ? acc + 1 : acc), 0);
}

function analyze(input: SimulationInput): Signals {
  const targetUser = input.targetUser || input.audience || "";
  const combinedText = `${input.idea} ${targetUser} ${input.goal ?? ""} ${input.constraints ?? ""} ${input.timeline ?? ""} ${input.evidence ?? ""}`.toLowerCase();
  const wordCount = input.idea.trim().split(/\s+/).filter(Boolean).length;

  const audienceNouns = [
    "students", "founders", "builders", "developers", "engineers", "teams",
    "freelancers", "designers", "parents", "creators", "job seekers", "marketers",
  ];
  const genericAudience = ["for everyone", "for anyone", "for people", "for many", "for all", "for everybody"];
  const namesAnAudience =
    countHits(combinedText, audienceNouns) > 0 ||
    countHits(combinedText, ["aimed at", "target"]) > 0 ||
    (combinedText.includes("for ") && countHits(combinedText, genericAudience) === 0);

  const timelineMarkers = ["week", "weeks", "day", "days", "month", "months", "deadline", "by end of"];

  const domains = DOMAINS.filter((d) => d.keywords.some((k) => combinedText.includes(k))).map((d) => ({
    name: d.name,
    complexity: d.complexity,
  }));

  return {
    text: combinedText,
    wordCount,
    hasAudience: Boolean(targetUser.trim()) || namesAnAudience,
    hasGoal: Boolean(input.goal?.trim()),
    hasConstraints: Boolean(input.constraints?.trim()),
    hasTimeline: Boolean(input.timeline?.trim()) || countHits(combinedText, timelineMarkers) > 0,
    hasPricing: countHits(combinedText, PRICING_WORDS) > 0,
    hasEvidence: Boolean(input.evidence?.trim()),
    evidenceText: input.evidence?.trim() || "",
    vagueHits: countHits(combinedText, VAGUE_WORDS),
    marketHits: countHits(combinedText, MARKET_WORDS),
    mvpHits: countHits(combinedText, MVP_WORDS),
    domains,
    totalComplexity: domains.reduce((acc, d) => acc + d.complexity, 0),
  };
}

function scoreDesirability(s: Signals): number {
  let score = 52;
  if (s.hasAudience) score += 12;
  if (s.marketHits > 0) score += Math.min(s.marketHits * 5, 15);
  if (s.hasPricing) score += 8;
  if (s.hasGoal) score += 6;
  if (s.hasEvidence) score += 12;
  score -= s.vagueHits * 8;
  return clamp(score);
}

function scoreFeasibility(s: Signals): number {
  let score = 65;
  score -= s.totalComplexity;
  if (s.hasConstraints) score += 8;
  if (s.hasTimeline) score += 8;
  if (s.mvpHits > 0) score += 8;
  if (s.wordCount < 6) score -= 10;
  return clamp(score);
}

function scoreDifferentiation(s: Signals): number {
  let score = 50;
  if (s.wordCount >= 20) score += 10;
  if (s.hasAudience && s.hasGoal) score += 12;
  if (s.domains.some((d) => d.name === "AI" || d.name === "SaaS")) score += 5;
  if (s.text.includes("unique") || s.text.includes("unlike") || s.text.includes("instead of")) score += 12;
  return clamp(score);
}

function scoreExecutionRisk(s: Signals): number {
  // Higher = safer (fewer risks)
  let score = 60;
  score -= s.totalComplexity;
  if (!s.hasAudience) score -= 12;
  if (s.hasTimeline) score += 8;
  if (s.hasConstraints) score += 8;
  score -= s.vagueHits * 6;
  if (s.hasEvidence) score += 10;
  return clamp(score);
}

function scoreConfidence(s: Signals): number {
  let score = 55;
  if (s.hasAudience) score += 10;
  if (s.hasTimeline) score += 5;
  if (s.hasEvidence) score += 20;
  if (s.vagueHits > 0) score -= 10;
  return clamp(score);
}

export function shortTopic(idea: string): string {
  const trimmed = idea.trim().replace(/\s+/g, " ");
  const words = trimmed.split(" ");
  if (words.length <= 14) return trimmed.replace(/[.?!]+$/, "");
  return words.slice(0, 14).join(" ") + "…";
}

function buildRisks(s: Signals): string[] {
  const risks: string[] = [];
  if (!s.hasAudience) {
    risks.push("No specific target user is named, so adoption and marketing risks are high.");
  }
  if (s.vagueHits > 0) {
    risks.push("The idea contains ambiguous language — the core problem needs sharper definition.");
  }
  for (const d of s.domains) {
    if (d.complexity >= 16) {
      risks.push(`${d.name} architecture carries high execution friction and implementation costs.`);
    }
  }
  if (!s.hasPricing && s.marketHits === 0) {
    risks.push("Willingness to pay is unverified; potential users may love the concept but refuse to pay.");
  }
  if (!s.hasTimeline) {
    risks.push("With no target timeline, scope can bloat before reaching a testable release.");
  }
  if (risks.length < 2) {
    risks.push("Building a full product before testing core assumptions directly in the market.");
  }
  return risks.slice(0, 5);
}

function buildNextSteps(s: Signals, topic: string): string[] {
  const steps: string[] = [];
  if (!s.hasAudience) {
    steps.push("Interview 5 potential users to confirm this is an acute, recurring pain point.");
  }
  steps.push(`Build a simple landing page or waitlist describing "${topic}" and test conversion.`);
  if (!s.hasPricing) {
    steps.push("Test pricing willingness (e.g. mock checkout or deposit) before writing backend code.");
  }
  steps.push("Collect qualitative feedback from 10 target users on the proposed solution.");
  if (s.hasTimeline) {
    steps.push("Set a time-boxed 7-day validation milestone to test core interest.");
  }
  return steps.slice(0, 6);
}

export function heuristicSimulation(input: SimulationInput): SimulationReport {
  const s = analyze(input);
  const topic = shortTopic(input.idea);

  const scores = {
    desirability: scoreDesirability(s),
    feasibility: scoreFeasibility(s),
    differentiation: scoreDifferentiation(s),
    executionRisk: scoreExecutionRisk(s),
    confidence: scoreConfidence(s),
  };

  const weakAssumption = !s.hasAudience
    ? "People in a specific market actually suffer from this problem enough to seek a solution."
    : !s.hasPricing
      ? "Target users will pay money to solve this problem rather than using existing free workarounds."
      : "The proposed value proposition is compelling enough to switch from established alternatives.";

  const experimentDesign = `Don't build the product yet. Build a simple landing page outlining "${topic}", run targeted outreach or small ads to recruit 10 target user interviews, collect email signups, and test willingness to pay.`;

  const recommendation =
    scores.confidence < 50
      ? "Run a non-coding validation sprint: test the weak assumption with target users before writing code."
      : scores.desirability >= 65 && scores.feasibility >= 60
        ? "High signal — proceed with building the smallest viable version while testing user willingness to pay."
        : "Promising concept — validate market demand with a landing page or prototype before investing heavy build time.";

  const targetUserVal = input.targetUser || input.audience;

  return {
    summary: `Simulation for "${topic}". ${
      s.hasEvidence ? `Factoring in real-world evidence: "${s.evidenceText}".` : "Evaluating initial intent and assumptions."
    }`,
    targetUser: targetUserVal
      ? `Defined target user: ${targetUserVal.trim()}`
      : "No target user defined yet. Identify one specific persona to focus validation.",
    problemClarity:
      scores.desirability >= 60
        ? "The problem definition is clear and addresses an explicit need."
        : "The problem statement is still broad. Frame the exact situation and friction point.",
    differentiation:
      scores.differentiation >= 60
        ? "Clear differentiation from existing alternatives."
        : "Differentiation is soft. Highlight the core edge or unique workflow.",
    marketDemand:
      s.hasEvidence
        ? `Validated with evidence: ${s.evidenceText}`
        : "Market demand is currently assumed. Gather user feedback to turn assumptions into evidence.",
    mvpSuggestion: `Build the simplest version of "${topic}" that tests the core value hypothesis without unnecessary fluff.`,
    scores,
    weakAssumption,
    experimentDesign,
    risks: buildRisks(s),
    nextSteps: buildNextSteps(s, topic),
    recommendation,
  };
}
