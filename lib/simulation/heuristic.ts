import type { SimulationInput, SimulationReport } from "./schema";

/**
 * A deterministic, offline simulation engine.
 *
 * It is NOT a language model — it is a transparent rule-based analyst that
 * inspects the idea text for concrete signals (a named audience, a timeline,
 * pricing, vague language, high-complexity domains) and turns them into a
 * structured, scored report. Determinism is the point: the app runs with zero
 * credentials and the output is stable enough to assert on in tests.
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

const MVP_WORDS = ["mvp", "prototype", "simple", "landing page", "waitlist", "demo"];

// Domains with their complexity cost (how much they erode practicality/safety).
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
  hasTimeline: boolean;
  hasPricing: boolean;
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
  const text = `${input.idea} ${input.audience ?? ""} ${input.timeline ?? ""}`.toLowerCase();
  const wordCount = input.idea.trim().split(/\s+/).filter(Boolean).length;

  const audienceNouns = [
    "students", "founders", "builders", "developers", "engineers", "teams",
    "freelancers", "designers", "parents", "creators", "job seekers", "marketers",
  ];
  // "for X" implies an audience — unless X is a generic, everyone-shaped phrase.
  const genericAudience = ["for everyone", "for anyone", "for people", "for many", "for all", "for everybody"];
  const namesAnAudience =
    countHits(text, audienceNouns) > 0 ||
    countHits(text, ["aimed at", "target"]) > 0 ||
    (text.includes("for ") && countHits(text, genericAudience) === 0);

  const timelineMarkers = ["week", "weeks", "day", "days", "month", "months", "deadline", "by end of"];

  const domains = DOMAINS.filter((d) => d.keywords.some((k) => text.includes(k))).map((d) => ({
    name: d.name,
    complexity: d.complexity,
  }));

  return {
    text,
    wordCount,
    hasAudience: Boolean(input.audience?.trim()) || namesAnAudience,
    hasTimeline: Boolean(input.timeline?.trim()) || countHits(text, timelineMarkers) > 0,
    hasPricing: countHits(text, PRICING_WORDS) > 0,
    vagueHits: countHits(text, VAGUE_WORDS),
    marketHits: countHits(text, MARKET_WORDS),
    mvpHits: countHits(text, MVP_WORDS),
    domains,
    totalComplexity: domains.reduce((acc, d) => acc + d.complexity, 0),
  };
}

function scoreClarity(s: Signals): number {
  let score = 45;
  if (s.wordCount >= 12) score += 15;
  if (s.wordCount >= 30) score += 8;
  if (s.hasAudience) score += 12;
  if (s.hasTimeline) score += 8;
  if (s.hasPricing) score += 6;
  score -= s.vagueHits * 12;
  if (s.wordCount < 6) score -= 15;
  return clamp(score);
}

function scorePracticality(s: Signals): number {
  let score = 60;
  score -= s.totalComplexity;
  if (s.hasTimeline) score += 8;
  if (s.mvpHits > 0) score += 10;
  if (s.wordCount < 6) score -= 8;
  return clamp(score);
}

function scoreOpportunity(s: Signals): number {
  let score = 48;
  score += Math.min(s.marketHits * 6, 18);
  if (s.domains.some((d) => d.name === "AI" || d.name === "SaaS")) score += 10;
  if (s.hasPricing) score += 8;
  if (s.text.includes("hobby") || s.text.includes("just for fun")) score -= 12;
  return clamp(score);
}

function scoreRisk(s: Signals): number {
  // Higher = safer.
  let score = 65;
  score -= s.totalComplexity;
  if (!s.hasAudience) score -= 12;
  score -= s.vagueHits * 6;
  if (s.hasTimeline && s.mvpHits > 0) score += 10;
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
    risks.push("No specific audience is named, so it's hard to know who would actually use this or why.");
  }
  if (s.vagueHits > 0) {
    risks.push("The idea still contains vague language — the core problem isn't sharply defined yet.");
  }
  for (const d of s.domains) {
    if (d.complexity >= 16) {
      risks.push(`${d.name} ideas carry high execution and adoption cost — expect this to be slower and riskier than it looks.`);
    }
  }
  if (!s.hasPricing && s.marketHits === 0) {
    risks.push("There's no signal of how this makes money or why anyone would pay, so demand is unproven.");
  }
  if (!s.hasTimeline) {
    risks.push("With no timeline, scope can creep indefinitely and the project may never reach a testable version.");
  }
  if (risks.length < 2) {
    risks.push("The biggest risk is building before validating: confirm real demand before investing heavily.");
  }
  return risks.slice(0, 5);
}

function buildNextSteps(s: Signals, topic: string): string[] {
  const steps: string[] = [];
  if (!s.hasAudience) {
    steps.push("Name one specific first user (a real person or tight segment) you can talk to this week.");
  }
  steps.push(`Write a one-paragraph problem statement for "${topic}" and validate it with 5 potential users.`);
  if (s.mvpHits === 0) {
    steps.push("Define the smallest version that delivers the core value — what can you ship in days, not months?");
  }
  if (!s.hasPricing) {
    steps.push("Decide a pricing hypothesis (even a rough one) so you can test willingness to pay early.");
  }
  steps.push("Build a fake-door or landing page and measure interest before writing production code.");
  if (s.hasTimeline) {
    steps.push("Lock a time-boxed milestone and cut scope ruthlessly to hit it.");
  }
  return steps.slice(0, 6);
}

export function heuristicSimulation(input: SimulationInput): SimulationReport {
  const s = analyze(input);
  const topic = shortTopic(input.idea);

  const scores = {
    clarity: scoreClarity(s),
    practicality: scorePracticality(s),
    opportunity: scoreOpportunity(s),
    risk: scoreRisk(s),
  };

  const domainLabel = s.domains.length > 0 ? s.domains.map((d) => d.name).join(" / ") : "general software";

  const recommendation =
    scores.clarity < 45
      ? "Sharpen the idea before building: define who it's for and the one problem it solves, then re-simulate."
      : scores.opportunity >= 60 && scores.practicality >= 55
        ? "This looks worth a small, time-boxed validation sprint. Build the thinnest MVP and put it in front of real users fast."
        : "Promising but unproven — run a cheap validation test before committing real time or money.";

  return {
    summary: `You're exploring: ${topic}. Genie reads this as a ${domainLabel} idea at an ${scores.clarity >= 60 ? "reasonably clear" : "early, still-fuzzy"} stage.`,
    targetUser: s.hasAudience
      ? `A defined audience is present${input.audience ? ` (${input.audience.trim()})` : ""} — good. Tighten it to the single user who feels this pain most acutely.`
      : "No clear audience yet. Pick one narrow first user; 'everyone' is the fastest way to build something nobody wants.",
    problemClarity:
      scores.clarity >= 60
        ? "The underlying problem is reasonably well framed. Keep pressure-testing whether it's a problem people actively try to solve today."
        : "The problem is under-specified. State the painful, recurring situation this addresses in one concrete sentence.",
    differentiation:
      s.domains.some((d) => d.name === "AI")
        ? "In a crowded AI space, generic capability is not a moat — your edge must come from a specific workflow, dataset, or audience you serve better than anyone."
        : "Differentiation isn't established yet. Identify the existing alternatives (including 'doing nothing') and the one thing you'll do meaningfully better.",
    marketDemand:
      s.marketHits > 0 || s.hasPricing
        ? "There are signals you're thinking about real users and willingness to pay. Convert those assumptions into evidence with direct conversations."
        : "Demand is currently assumed, not observed. Talk to potential users before trusting your own enthusiasm.",
    mvpSuggestion:
      s.mvpHits > 0
        ? "You're already thinking in MVP terms — good. Strip it further: ship the single feature that proves the core value."
        : `Build the thinnest possible slice of "${topic}" — one core action, no accounts, no polish — and get it in front of 5 users.`,
    scores,
    risks: buildRisks(s),
    nextSteps: buildNextSteps(s, topic),
    recommendation,
  };
}
