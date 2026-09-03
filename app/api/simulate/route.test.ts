import { afterEach, describe, expect, it, vi } from "vitest";
import { simulationReportSchema } from "@/lib/simulation/schema";
import { MAX_BODY_BYTES } from "@/lib/http";
import { POST } from "./route";

const IDEA = "An AI agent that helps people prepare for job interviews with mock questions.";

let ipCounter = 0;
/** Each test gets its own IP so the shared rate limiter never bleeds between tests. */
function post(body: string, extra: Record<string, string> = {}, ip = `203.0.113.${++ipCounter}`) {
  return POST(
    new Request("http://genie.test/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip, ...extra },
      body,
    }),
  );
}

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/simulate", () => {
  it("returns a schema-valid report for a valid request", async () => {
    delete process.env.GENIE_LLM_API_KEY;
    const res = await post(JSON.stringify({ idea: IDEA }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(simulationReportSchema.safeParse(data.report).success).toBe(true);
    expect(data.engine).toBe("heuristic");
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/valid JSON/i);
  });

  it("rejects a schema violation with 400 and the Zod issues", async () => {
    const res = await post(JSON.stringify({ idea: "hi" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/more/i);
    expect(data.issues[0].path).toEqual(["idea"]);
  });

  it("rate limits after the per-IP allowance with a Retry-After header", async () => {
    const ip = "198.51.100.77";
    for (let i = 0; i < 10; i++) {
      expect((await post(JSON.stringify({ idea: IDEA }), {}, ip)).status).toBe(200);
    }
    const res = await post(JSON.stringify({ idea: IDEA }), {}, ip);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await res.json()).error).toMatch(/too many/i);
  });

  it("rejects oversized bodies with 413 before parsing", async () => {
    const res = await post(JSON.stringify({ idea: "x".repeat(MAX_BODY_BYTES + 1) }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/too large/i);
  });

  it("rejects an oversized declared Content-Length without reading the body", async () => {
    const res = await post(JSON.stringify({ idea: IDEA }), { "content-length": String(MAX_BODY_BYTES + 1) });
    expect(res.status).toBe(413);
  });

  it("uses the LLM engine when it is configured and healthy", async () => {
    process.env.GENIE_LLM_API_KEY = "test-key";
    const { heuristicSimulation } = await import("@/lib/simulation/heuristic");
    const report = heuristicSimulation({ idea: IDEA });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report) } }] }), { status: 200 }),
      ),
    );

    const res = await post(JSON.stringify({ idea: IDEA }));
    expect(res.status).toBe(200);
    expect((await res.json()).engine).toBe("llm");
  });

  it("falls back to the heuristic engine end-to-end when the configured LLM fails", async () => {
    // The contract that matters most: a broken upstream must still yield a
    // complete report, and the fallback must leave a measurable trace in the logs.
    process.env.GENIE_LLM_API_KEY = "test-key";
    process.env.GENIE_LOG_LEVEL = "info";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 502 })));
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    const res = await post(JSON.stringify({ idea: IDEA }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.engine).toBe("heuristic");
    expect(simulationReportSchema.safeParse(data.report).success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    const events = lines.map((l) => JSON.parse(l));
    expect(events.find((e) => e.event === "llm.failed")).toMatchObject({
      feature: "simulate",
      errorKind: "status",
      status: 502,
    });
    expect(events.find((e) => e.event === "simulation.completed")).toMatchObject({
      engine: "heuristic",
      llmConfigured: true,
      fallback: true,
    });
    // Raw IPs never reach the logs; only the salted hash does.
    expect(lines.join("\n")).not.toContain("203.0.113.");
    expect(lines.join("\n")).not.toContain("test-key");
  });
});
