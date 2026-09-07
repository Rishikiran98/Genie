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

/**
 * Regulatory / licensing language. Any of these in the constraints or the idea
 * means an external authority can veto the idea outright, which outranks every
 * other risk. Matched case-insensitively as substrings.
 */
const REGULATORY_WORDS = [
  "regulation",
  "regulatory",
  "regulated",
  "licence",
  "license",
  "licensing",
  "permit",
  "compliance",
  "compliant",
  "hipaa",
  "fda",
  "gdpr",
  "health code",
  "food safety",
  "cottage food",
  "insurance",
  "liability",
  "legal",
  "kyc",
  "aml",
];

const SOLO_WORDS = [
  "solo founder",
  "solo",
  "just me",
  "by myself",
  "myself",
  "no team",
  "no cofounder",
  "no co-founder",
  "one person",
  "single founder",
  "non-technical",
  "no engineers",
  "no developer",
];

const SINGLE_MARKET_WORDS = [
  "one neighborhood",
  "one neighbourhood",
  "single neighborhood",
  "single neighbourhood",
  "one city",
  "single city",
  "one town",
  "one market",
  "single market",
  "one region",
  "one campus",
  "one school",
  "local only",
  "only locally",
];

/**
 * Structural demand problems: both sides of a market (or a critical mass of
 * members) must exist before anyone gets value. These words flag that shape.
 */
const COLD_START_WORDS = [
  "marketplace",
  "two-sided",
  "two sided",
  "buyers and sellers",
  "sellers",
  "platform connecting",
  "connects",
  "connecting",
  "network effect",
  "network effects",
  "community of",
  "social network",
  "matching",
  "match ",
];

/**
 * Comparative language: the only way the input can *state* differentiation.
 * Without one of these, the report must not claim the idea is differentiated.
 */
const DIFFERENTIATION_WORDS = [
  "unlike",
  "instead of",
  "unique",
  "competitor",
  "existing tools",
  "existing alternatives",
  "existing solutions",
  "existing apps",
  "existing services",
  "compared to",
  "better than",
  "cheaper than",
  "faster than",
  "simpler than",
  "no one else",
  "nobody else",
  "differentiat",
  "whereas",
  "alternative to",
  "replaces",
  "rather than",
];

/** Words that describe a pain or friction, i.e. that the input explains *why* someone would want this. */
const PAIN_WORDS = [
  "struggle",
  "waste",
  "wasting",
  "hard to",
  "difficult",
  "pain",
  "frustrat",
  "can't",
  "cannot",
  "manual",
  "manually",
  "slow",
  "expensive",
  "problem",
  "tedious",
  "time-consuming",
  "error-prone",
  "miss",
  "forget",
  "no way to",
];

/**
 * Epistemic ceilings when no evidence is supplied. Without real-world signal
 * (interviews, signups, payments) demand is a hypothesis, however well the
 * idea is written, so desirability is capped at "promising" and confidence at
 * "coin-flip plus". This is a deliberate choice about what a score can
 * honestly mean, not a tuning constant: lift it only if the input gains a
 * field that carries real evidence.
 */
const NO_EVIDENCE_DESIRABILITY_CEILING = 70;
const NO_EVIDENCE_CONFIDENCE_CEILING = 55;

/** Budget thresholds, USD. Below `SHOESTRING` there is no room for paid acquisition or hiring at all. */
const BUDGET_SHOESTRING_USD = 5_000;
/** Below `TIGHT` you can buy some validation but not a build team. */
const BUDGET_TIGHT_USD = 25_000;

/** What the constraints field actually says, rather than whether it was filled in. */
export interface ConstraintSignals {
  /** The raw constraints text, trimmed (empty when absent). */
  raw: string;
  /** A hard budget figure in USD when one was stated. */
  budgetUsd: number | null;
  /** 0 = none or comfortable, 1 = tight (< $25k), 2 = shoestring (< $5k or explicitly none). */
  budgetSeverity: 0 | 1 | 2;
  /** The user's own words for the budget clause, for quoting back. */
  budgetQuote: string | null;
  soloFounder: boolean;
  soloQuote: string | null;
  singleMarket: boolean;
  singleMarketQuote: string | null;
  /** The user's own words for the regulatory clause, when one exists. */
  regulatoryQuote: string | null;
}

/** Splits a free-text constraints field into its clauses ("$2,000 budget", "solo founder", ...). */
function clauses(text: string): string[] {
  return text
    // Commas separate clauses unless they are thousands separators ("$2,000").
    .split(/,(?!\d{3})|[;\n]|\s[—–-]\s|(?<=[.!?])\s|\band\b/i)
    .map((c) => c.trim().replace(/^[-–—•\s]+|[.\s]+$/g, ""))
    .filter(Boolean);
}

/** Returns the first clause containing any of `words`, in the user's own words. */
function quoteClause(text: string, words: string[]): string | null {
  for (const clause of clauses(text)) {
    const lower = clause.toLowerCase();
    if (words.some((w) => lower.includes(w))) return clause;
  }
  return null;
}

/** Parses a dollar figure like "$2,000", "$2k", "2k budget", "$1.5m". Returns the smallest one found. */
function parseBudgetUsd(text: string): number | null {
  const pattern = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*([km])?\b|\b(\d[\d,]*(?:\.\d+)?)\s*([km])\b(?=[^\n]*budget)/gi;
  let smallest: number | null = null;
  for (const m of text.matchAll(pattern)) {
    const digits = (m[1] ?? m[3] ?? "").replace(/,/g, "");
    const unit = (m[2] ?? m[4] ?? "").toLowerCase();
    if (!digits) continue;
    let value = Number(digits);
    if (unit === "k") value *= 1_000;
    if (unit === "m") value *= 1_000_000;
    if (!Number.isFinite(value)) continue;
    smallest = smallest === null ? value : Math.min(smallest, value);
  }
  return smallest;
}

export function analyzeConstraints(input: SimulationInput): ConstraintSignals {
  const raw = input.constraints?.trim() ?? "";
  const lower = raw.toLowerCase();
  const ideaLower = input.idea.toLowerCase();

  const budgetUsd = parseBudgetUsd(raw);
  const explicitlyNoBudget = /\b(no|zero|\$0)\s*budget\b|\bbootstrapp/i.test(raw);
  const budgetSeverity: 0 | 1 | 2 =
    explicitlyNoBudget || (budgetUsd !== null && budgetUsd < BUDGET_SHOESTRING_USD)
      ? 2
      : budgetUsd !== null && budgetUsd < BUDGET_TIGHT_USD
        ? 1
        : 0;

  const soloFounder = SOLO_WORDS.some((w) => lower.includes(w));
  const singleMarket = SINGLE_MARKET_WORDS.some((w) => lower.includes(w));

  // Regulation can be stated as a constraint or be inherent in the idea itself
  // ("a HIPAA-compliant patient app"). Quote the constraints clause when there
  // is one, else the matching words from the idea.
  const regulatoryQuote =
    quoteClause(raw, REGULATORY_WORDS) ??
    (() => {
      const hit = REGULATORY_WORDS.find((w) => ideaLower.includes(w));
      if (!hit) return null;
      const match = input.idea.match(new RegExp(`[\\w-]*${hit.replace(/\s+/g, "\\s+")}[\\w-]*`, "i"));
      return match?.[0] ?? hit;
    })();

  return {
    raw,
    budgetUsd,
    budgetSeverity,
    budgetQuote: budgetSeverity > 0 ? (quoteClause(raw, ["$", "budget", "bootstrapp"]) ?? raw) : null,
    soloFounder,
    soloQuote: soloFounder ? quoteClause(raw, SOLO_WORDS) : null,
    singleMarket,
    singleMarketQuote: singleMarket ? quoteClause(raw, SINGLE_MARKET_WORDS) : null,
    regulatoryQuote,
  };
}

interface Signals {
  text: string;
  wordCount: number;
  hasAudience: boolean;
  hasGoal: boolean;
  hasConstraints: boolean;
  constraints: ConstraintSignals;
  hasTimeline: boolean;
  hasPricing: boolean;
  hasEvidence: boolean;
  /** Evidence that contains a number ("10 interviews", "8 signups") — weightier than prose. */
  quantifiedEvidence: boolean;
  evidenceText: string;
  /** Two-sided / network-shaped: value needs supply and demand to exist first. */
  coldStart: boolean;
  /** The clause in which the user stated how this differs from alternatives, if they did. */
  differentiationQuote: string | null;
  /** Whether the input explains the pain it removes, not just the product. */
  describesPain: boolean;
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
  // Pricing signals come from what the idea charges, not from a budget line
  // in the constraints ("$2,000 budget" is not a price).
  const pricingText = `${input.idea} ${input.goal ?? ""} ${input.evidence ?? ""}`.toLowerCase();
  const evidenceText = input.evidence?.trim() || "";
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
    constraints: analyzeConstraints(input),
    hasTimeline: Boolean(input.timeline?.trim()) || countHits(combinedText, timelineMarkers) > 0,
    hasPricing: countHits(pricingText, PRICING_WORDS) > 0,
    hasEvidence: Boolean(evidenceText),
    quantifiedEvidence: /\d/.test(evidenceText),
    evidenceText,
    coldStart: countHits(combinedText, COLD_START_WORDS) > 0,
    differentiationQuote: quoteClause(`${input.idea}. ${input.goal ?? ""}`, DIFFERENTIATION_WORDS),
    describesPain: countHits(combinedText, PAIN_WORDS) > 0,
    vagueHits: countHits(combinedText, VAGUE_WORDS),
    marketHits: countHits(combinedText, MARKET_WORDS),
    mvpHits: countHits(combinedText, MVP_WORDS),
    domains,
    totalComplexity: domains.reduce((acc, d) => acc + d.complexity, 0),
  };
}

function scoreDesirability(s: Signals): number {
  let score = 50;
  if (s.hasAudience) score += 10;
  // Commerce vocabulary ("customers", "revenue", "sell") is a weak signal that
  // the author is thinking commercially — not evidence that anyone wants this.
  // Capped low so wording alone cannot move the score much.
  if (s.marketHits > 0) score += Math.min(s.marketHits * 2, 5);
  if (s.hasPricing) score += 6;
  if (s.hasGoal) score += 4;
  // Evidence is the only thing that can lift demand above "promising".
  if (s.hasEvidence) score += s.quantifiedEvidence ? 17 : 12;
  // Cold start: a marketplace or network has no value for the first user on
  // either side, so stated demand is discounted until supply is shown to exist.
  if (s.coldStart) score -= 10;
  score -= s.vagueHits * 8;
  if (!s.hasEvidence) score = Math.min(score, NO_EVIDENCE_DESIRABILITY_CEILING);
  return clamp(score);
}

/**
 * How much each severe constraint costs. Constraints are not a bonus for
 * "thinking clearly" here — that credit lives in confidence. A stated
 * constraint that makes the build harder must make the score lower.
 */
const CONSTRAINT_COST = {
  feasibility: { shoestring: 10, tight: 5, solo: 5, regulatory: 10 },
  // Execution risk is "higher = safer", so these are subtracted from safety.
  safety: { shoestring: 6, tight: 3, solo: 6, regulatory: 12 },
} as const;

function constraintCost(c: ConstraintSignals, table: { shoestring: number; tight: number; solo: number; regulatory: number }): number {
  let cost = 0;
  if (c.budgetSeverity === 2) cost += table.shoestring;
  if (c.budgetSeverity === 1) cost += table.tight;
  if (c.soloFounder) cost += table.solo;
  if (c.regulatoryQuote) cost += table.regulatory;
  return cost;
}

function scoreFeasibility(s: Signals): number {
  let score = 65;
  score -= s.totalComplexity;
  score -= constraintCost(s.constraints, CONSTRAINT_COST.feasibility);
  if (s.hasTimeline) score += 8;
  if (s.mvpHits > 0) score += 8;
  if (s.wordCount < 6) score -= 10;
  return clamp(score);
}

/** Neutral: nothing was said about alternatives, so nothing is known either way. */
const DIFFERENTIATION_NEUTRAL = 50;

function scoreDifferentiation(s: Signals): number {
  // Only an explicit contrast can move this above neutral. Word count, a named
  // audience, or a fashionable domain say nothing about alternatives.
  if (!s.differentiationQuote) return clamp(DIFFERENTIATION_NEUTRAL - s.vagueHits * 4);
  let score = DIFFERENTIATION_NEUTRAL + 15;
  // A contrast aimed at a specific audience is sharper than a generic one.
  if (s.hasAudience) score += 5;
  score -= s.vagueHits * 4;
  return clamp(score);
}

function scoreExecutionRisk(s: Signals): number {
  // Higher = safer (fewer risks)
  let score = 60;
  score -= s.totalComplexity;
  score -= constraintCost(s.constraints, CONSTRAINT_COST.safety);
  if (!s.hasAudience) score -= 12;
  if (s.hasTimeline) score += 8;
  score -= s.vagueHits * 6;
  if (s.hasEvidence) score += 10;
  return clamp(score);
}

function scoreConfidence(s: Signals): number {
  let score = 40;
  if (s.hasAudience) score += 8;
  if (s.hasGoal) score += 4;
  if (s.hasTimeline) score += 3;
  // Naming constraints at all is mild evidence the author has thought it
  // through — worth a little confidence, never feasibility.
  if (s.hasConstraints) score += 4;
  if (s.hasEvidence) score += s.quantifiedEvidence ? 25 : 18;
  if (s.vagueHits > 0) score -= 10;
  if (!s.hasEvidence) score = Math.min(score, NO_EVIDENCE_CONFIDENCE_CEILING);
  return clamp(score);
}

// ---------------------------------------------------------------------------
// Idea label
// ---------------------------------------------------------------------------

const LEAD_INS =
  /^(i want to|i'd like to|i would like to|we want to|we'd like to|i plan to|we plan to|i am building|i'm building|we are building|we're building|building|build|create|creating|make|making|launch|launching|develop|developing|start|starting|an idea for|idea:|idea for|my idea is)\s+/i;
const ARTICLES = /^(a|an|the)\s+/i;
/** Where the head noun phrase of an idea usually ends. */
const CONNECTIVES =
  /\s+(where|that|which|who|whose|so|because|by|using|via|connecting|helping|helps|lets|letting|enabling|allowing|allows|to help|to let)\s+|[,;:—–]|\s-\s/i;
/** Words that end a subject noun phrase after "where" / "connecting". */
const SUBJECT_STOPS = new Set(["sell", "sells", "buy", "buys", "can", "who", "that", "get", "offer", "to", "and", "with", "share", "post", "find"]);
const TRAILING_STOPS = new Set(["for", "to", "of", "with", "and", "on", "in", "at", "from", "or"]);
const DEGENERATE_HEADS = new Set(["i", "we", "you", "it", "something", "someone", "anything", "my", "our", "this", "there"]);
const LABEL_MAX_WORDS = 5;

/**
 * A short noun-phrase label for the idea, generated once per report so prose
 * can say "the home-cook marketplace" instead of splicing the user's full text
 * (with an ellipsis) into every sentence. Falls back to "the idea" when the
 * input has no usable head noun. Deterministic.
 */
export function ideaLabel(idea: string): string {
  let text = idea.trim().replace(/\s+/g, " ").replace(/[.?!]+$/, "");
  for (let i = 0; i < 3 && LEAD_INS.test(text); i++) text = text.replace(LEAD_INS, "");
  text = text.replace(ARTICLES, "");

  const match = CONNECTIVES.exec(text);
  let head = match ? text.slice(0, match.index) : text;
  let words = head.split(" ").filter(Boolean);

  // "Marketplace where local home cooks sell…" → "marketplace for local home cooks"
  const connective = match?.[1]?.toLowerCase();
  if (words.length === 1 && match && (connective === "where" || connective === "connecting")) {
    const subject: string[] = [];
    for (const w of text.slice(match.index + match[0].length).split(" ")) {
      if (SUBJECT_STOPS.has(w.toLowerCase()) || subject.length === 3) break;
      subject.push(w);
    }
    if (subject.length > 0) words = [...words, "for", ...subject];
  }

  words = words.slice(0, LABEL_MAX_WORDS);
  while (words.length > 0 && TRAILING_STOPS.has(words[words.length - 1].toLowerCase())) words.pop();
  if (words.length === 0 || DEGENERATE_HEADS.has(words[0].toLowerCase())) return "the idea";

  const first = words[0];
  const isAcronym = first.length > 1 && first === first.toUpperCase();
  words[0] = isAcronym ? first : first[0].toLowerCase() + first.slice(1);
  head = words.join(" ");
  return `the ${head}`;
}

/** One risk line per detected constraint, quoting the user's own words. Regulatory first. */
function constraintRisks(c: ConstraintSignals): string[] {
  const risks: string[] = [];
  if (c.regulatoryQuote) {
    risks.push(
      `Regulatory blocker: "${c.regulatoryQuote}" — if the rules in your jurisdiction forbid or license this activity, nothing else in the plan matters.`,
    );
  }
  if (c.budgetSeverity === 2) {
    risks.push(`Budget: "${c.budgetQuote}" leaves no room for paid acquisition, hiring, or a second attempt if the first test fails.`);
  } else if (c.budgetSeverity === 1) {
    risks.push(`Budget: "${c.budgetQuote}" covers validation but not a build team, so scope must stay tiny.`);
  }
  if (c.soloFounder) {
    risks.push(`Team: "${c.soloQuote}" means one person carries supply, demand, product, and operations — the first bottleneck is your own time.`);
  }
  if (c.singleMarket) {
    risks.push(`Scope: "${c.singleMarketQuote}" caps how much demand the test can reveal; a good result there does not prove the model travels.`);
  }
  return risks;
}

function buildRisks(s: Signals): string[] {
  const risks: string[] = [...constraintRisks(s.constraints)];
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
  if (s.coldStart) {
    risks.push("Cold start: neither side of the market gets value until the other shows up, so early supply has to be recruited by hand.");
  }
  if (!s.hasPricing) {
    risks.push("Willingness to pay is unverified; potential users may love the concept but refuse to pay.");
  }
  if (!s.hasTimeline) {
    risks.push("With no target timeline, scope can bloat before reaching a testable release.");
  }
  if (risks.length < 2) {
    risks.push("Building a full product before testing core assumptions directly in the market.");
  }
  return risks.slice(0, 6);
}

function buildNextSteps(s: Signals, label: string, binding: BindingConstraint): string[] {
  const steps: string[] = [];
  if (binding.kind === "regulatory" || binding.kind === "cold_start") {
    steps.push(`${binding.day1.focus}: ${binding.day1.tasks[0]}`);
  }
  if (!s.hasAudience) {
    steps.push("Interview 5 potential users to confirm this is an acute, recurring pain point.");
  }
  steps.push(`Build a simple landing page or waitlist describing ${label} and test conversion.`);
  if (!s.hasPricing) {
    steps.push("Test pricing willingness (e.g. mock checkout or deposit) before writing backend code.");
  }
  steps.push("Collect qualitative feedback from 10 target users on the proposed solution.");
  if (s.hasTimeline) {
    steps.push("Set a time-boxed 7-day validation milestone to test core interest.");
  }
  return steps.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Binding constraint
// ---------------------------------------------------------------------------

/**
 * The single thing most likely to kill the idea before the others matter.
 * Priority is fixed: a legal veto makes every other test pointless; a
 * two-sided idea with no supply cannot test demand; unproven willingness to
 * pay comes before worrying about whether it can be built.
 */
export type BindingConstraintKind = "regulatory" | "cold_start" | "willingness_to_pay" | "feasibility";

export interface BindingConstraint {
  kind: BindingConstraintKind;
  /** Short noun phrase for prose ("the legal question (\"food regulations\")"). */
  label: string;
  weakAssumption: string;
  experimentDesign: string;
  recommendation: string;
  /** The first day of the action plan, which must start here. */
  day1: { focus: string; tasks: string[] };
}

/** Which body of rules to point the user at, from the idea's own words. */
function regulatoryHint(text: string): string {
  const t = text.toLowerCase();
  if (/\b(food|meal|meals|cook|cooks|kitchen|bak(e|ing)|catering)\b/.test(t)) return "cottage-food and health-code rules for home kitchens";
  if (/\b(health|patient|patients|medical|clinic|therapy|therapist|diagnos)/.test(t)) return "health-data (HIPAA / GDPR) and medical-device rules";
  if (/\b(loan|lending|payment|payments|invest|investing|bank|banking|insurance|credit)\b/.test(t)) return "financial-services licensing (KYC / AML)";
  if (/\b(alcohol|cannabis|tobacco|vape)\b/.test(t)) return "controlled-substance licensing";
  if (/\b(kids|children|minors|under 13)\b/.test(t)) return "child-privacy rules (COPPA / age verification)";
  if (/\b(rental|rentals|housing|tenant|sublet)\b/.test(t)) return "housing and short-term-rental rules";
  if (/\b(drone|drones|aircraft)\b/.test(t)) return "aviation rules";
  return "the licensing and compliance rules that apply";
}

const PAID_EVIDENCE = /\b(paid|pre-?paid|pre-?order|purchase|bought|revenue|deposit|invoice)\b|\$\d/i;

function rankConstraints(s: Signals): BindingConstraintKind[] {
  const order: BindingConstraintKind[] = [];
  if (s.constraints.regulatoryQuote) order.push("regulatory");
  if (s.coldStart) order.push("cold_start");
  if (!(s.hasEvidence && PAID_EVIDENCE.test(s.evidenceText))) order.push("willingness_to_pay");
  order.push("feasibility");
  return order;
}

function describeConstraint(kind: BindingConstraintKind, s: Signals, input: SimulationInput, next: string | null): BindingConstraint {
  const audience = (input.targetUser || input.audience)?.trim();
  const who = audience ? `"${audience}"` : "your target users";
  const then = next ? ` If it clears, the next blocker is ${next}.` : "";

  switch (kind) {
    case "regulatory": {
      const quote = s.constraints.regulatoryQuote ?? "the regulatory constraint";
      const hint = regulatoryHint(`${input.idea} ${input.constraints ?? ""}`);
      return {
        kind,
        label: `the legal question ("${quote}")`,
        weakAssumption: `That "${quote}" permits this to operate at all in your jurisdiction — if it does not, nothing else in this report matters.`,
        experimentDesign: `Before anything else, confirm this is legal in your jurisdiction: identify ${hint}, ask the local authority or a specialist, and get a written yes/no with any conditions (permits, inspections, insurance). Only then test demand.`,
        recommendation: `Do not build yet. Resolve the legal question first: "${quote}" can veto the idea outright, so a day spent confirming ${hint} is worth more than a month of anything else.${then}`,
        day1: {
          focus: "Confirm it is legal before anything else",
          tasks: [
            `Identify ${hint} for "${quote}" — the exact rules, who enforces them, and what a compliant operation must have.`,
            "Call or email the enforcing authority (or a specialist) and ask for a written answer: allowed, allowed with conditions, or not allowed.",
            `Write the kill criterion now: if "${quote}" cannot be satisfied within your budget and timeline, stop here and pivot.`,
          ],
        },
      };
    }
    case "cold_start":
      return {
        kind,
        label: "the supply-side cold start",
        weakAssumption: "Enough of the supply side (the people providing the goods or service) will sign up and stay active before there is demand to pay them.",
        experimentDesign: `Recruit the supply side by hand first: get 5–10 providers committed in writing to list before spending anything on demand, then match the first orders to ${who} manually (concierge) to prove both sides transact.`,
        recommendation: `Do not build the platform yet. Line up supply by hand, run concierge matches, and only if both sides transact repeatedly is a build justified.${then}`,
        day1: {
          focus: "Line up the supply side by hand",
          tasks: [
            "List 20 candidate providers you could reach this week and contact 10 of them directly.",
            "Ask each what they would need to list (pricing, effort, trust) and note who says yes without prompting.",
            "Define the supply success metric for the week (e.g. 5 committed providers) — no demand work until it is met.",
          ],
        },
      };
    case "willingness_to_pay":
      return {
        kind,
        label: "willingness to pay",
        weakAssumption: `${who === "your target users" ? "Target users" : who} will pay money to solve this problem rather than using existing free workarounds.`,
        experimentDesign: `Don't build the product yet. Put up a one-page description, recruit 10 interviews with ${who}, and ask for a deposit or pre-order rather than an email address — a payment is evidence, a signup is not.`,
        recommendation: `Validate before building: test whether ${who} will pay, with a pre-order or deposit, before writing code. The scores above read the framing, not demand.${then}`,
        day1: {
          focus: "Sharpen the problem and identify weak assumptions",
          tasks: [
            !audience || s.vagueHits > 0
              ? "Write the problem you're solving in one concrete sentence — the painful, recurring situation."
              : `Identify the weak assumption: "${who} will pay money to solve this problem rather than using existing free workarounds."`,
            audience
              ? `Profile one specific target user within ${who}.`
              : "Pick ONE narrow target user persona you can reach this week.",
            "List the alternatives they currently use to solve this problem.",
          ],
        },
      };
    case "feasibility":
      return {
        kind,
        label: "build feasibility",
        weakAssumption: "The hardest part of this can be built and operated within the stated constraints.",
        experimentDesign: "Spike the hardest component for two days before anything else: prove it works end-to-end at toy scale and measure what it costs to run.",
        recommendation: `Demand has some evidence behind it; the open question is whether this can be built as constrained. Spike the riskiest component before committing to a full build.${then}`,
        day1: {
          focus: "De-risk the hardest component",
          tasks: [
            "Name the single hardest technical or operational piece and why it might not work.",
            "Build a throwaway spike of just that piece and run it end-to-end once.",
            "Record what it cost in time and money — that number sets the build scope.",
          ],
        },
      };
  }
}

/** The ordered chain of constraints for an input; the first is the binding one. */
export function constraintChain(input: SimulationInput): BindingConstraint[] {
  const s = analyze(input);
  const kinds = rankConstraints(s);
  return kinds.map((kind, i) => {
    const nextKind = kinds[i + 1];
    const next = nextKind ? describeConstraint(nextKind, s, input, null).label : null;
    return describeConstraint(kind, s, input, next);
  });
}

/** The single constraint most likely to kill the idea first. Drives recommendation, weak assumption, experiment and Day 1. */
export function bindingConstraint(input: SimulationInput): BindingConstraint {
  return constraintChain(input)[0];
}

/** Describes how well the *input* frames the problem — never whether the problem is real. */
function describeProblemClarity(s: Signals, input: SimulationInput): string {
  const present: string[] = [];
  const missing: string[] = [];
  (input.targetUser || input.audience ? present : missing).push(
    input.targetUser || input.audience ? "names who it is for" : "who it is for",
  );
  (s.hasGoal ? present : missing).push(s.hasGoal ? "states a goal" : "a goal");
  (s.describesPain ? present : missing).push(
    s.describesPain ? "describes the pain it removes" : "the specific recurring pain it removes",
  );
  const vague = s.vagueHits > 0 ? " Some of the wording is vague, which usually means the problem is not yet pinned down." : "";
  if (missing.length === 0) {
    return `The input ${present.join(", ")}. That frames the problem well; whether the pain is felt as strongly as described is still unverified.${vague}`;
  }
  if (present.length === 0) {
    return `The input describes a product but not the problem: it does not say ${missing.join(", or ")}. Until it does, every other score rests on guesswork.${vague}`;
  }
  return `The input ${present.join(" and ")}, but does not say ${missing.join(" or ")} — that remains an assumption.${vague}`;
}

function describeDifferentiation(s: Signals): string {
  if (!s.differentiationQuote) {
    return "No differentiation from existing alternatives was stated — this is untested. Name what your target user uses for this today and why they would switch.";
  }
  return `Stated differentiation: "${s.differentiationQuote}". Treat it as a hypothesis — nothing in the input shows that target users see or value that difference.`;
}

function describeMarketDemand(s: Signals): string {
  if (!s.hasEvidence) {
    return "No demand evidence was supplied. Desirability is inferred from the framing alone and capped accordingly; repeat use and willingness to pay remain assumptions until tested.";
  }
  return `Evidence supplied: "${s.evidenceText}". This is the only demand signal in the input — weight it by how many people it covers and whether money changed hands.`;
}

export function heuristicSimulation(input: SimulationInput): SimulationReport {
  const s = analyze(input);
  const label = ideaLabel(input.idea);

  const scores = {
    desirability: scoreDesirability(s),
    feasibility: scoreFeasibility(s),
    differentiation: scoreDifferentiation(s),
    executionRisk: scoreExecutionRisk(s),
    confidence: scoreConfidence(s),
  };

  // Everything advisory in the report leads with the binding constraint.
  const binding = bindingConstraint(input);
  const weakAssumption = binding.weakAssumption;
  const experimentDesign = binding.experimentDesign;
  const recommendation =
    binding.kind === "feasibility" && scores.desirability >= 65 && scores.feasibility >= 60
      ? "The supplied evidence supports moving to the smallest buildable version, while continuing to measure willingness to pay."
      : binding.recommendation;

  const targetUserVal = input.targetUser || input.audience;

  return {
    summary: `Simulation of ${label}. ${
      s.hasEvidence
        ? "Real-world evidence was supplied and is factored into the scores."
        : "No evidence was supplied — the scores reflect the stated intent, not measured demand."
    }`,
    targetUser: targetUserVal
      ? `Defined target user: ${targetUserVal.trim()}`
      : "No target user defined yet. Identify one specific persona to focus validation.",
    problemClarity: describeProblemClarity(s, input),
    differentiation: describeDifferentiation(s),
    marketDemand: describeMarketDemand(s),
    mvpSuggestion: `Build the simplest version of ${label} that tests the core value hypothesis without unnecessary fluff.`,
    scores,
    weakAssumption,
    experimentDesign,
    risks: buildRisks(s),
    nextSteps: buildNextSteps(s, label, binding),
    recommendation,
  };
}
