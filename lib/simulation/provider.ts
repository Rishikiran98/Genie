import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt";
import { simulationReportSchema, type SimulationInput, type SimulationReport } from "./schema";

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Per-request timeout in ms. Defaults to `DEFAULT_LLM_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/** Upper bound on a single LLM call; a hung upstream must not hang the route. */
export const DEFAULT_LLM_TIMEOUT_MS = 20_000;

/** Reads `GENIE_LLM_TIMEOUT_MS`, falling back to the default on missing or bad values. */
export function readLlmTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.GENIE_LLM_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_LLM_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_LLM_TIMEOUT_MS;
}

/**
 * Reads LLM configuration from the environment. Returns null when no API key is
 * configured, which is the signal for the engine to fall back to the offline
 * heuristic. This keeps Genie fully runnable with zero setup.
 */
export function readLlmConfig(
  env: Record<string, string | undefined> = process.env,
): LlmConfig | null {
  const apiKey = env.GENIE_LLM_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.GENIE_LLM_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: env.GENIE_LLM_MODEL?.trim() || "gpt-4o-mini",
    timeoutMs: readLlmTimeoutMs(env),
  };
}

/** Pulls the first JSON object out of a model response, tolerating stray prose or code fences. */
export function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in model response.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Calls an OpenAI-compatible Chat Completions endpoint with a system + user
 * message pair, expects a JSON object back, and returns it parsed (but not yet
 * schema-validated). Throws on any network, timeout, or parsing failure so
 * callers can decide whether to fall back. The call is bounded by
 * `config.timeoutMs` via `AbortSignal.timeout`, which rejects the fetch with a
 * `TimeoutError` — a hung upstream never hangs the route. Shared by every
 * LLM-backed feature.
 */
export async function chatJson(
  config: LlmConfig,
  system: string,
  user: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}): ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM response had no content.");

  return extractJson(content);
}

/**
 * Runs a full simulation through the LLM and validates the result against the
 * report schema.
 */
export async function llmSimulation(
  input: SimulationInput,
  config: LlmConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<SimulationReport> {
  const raw = await chatJson(config, SYSTEM_PROMPT, buildUserPrompt(input), fetchImpl);
  return simulationReportSchema.parse(raw);
}
