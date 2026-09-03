import { describe, expect, it } from "vitest";
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

describe("POST /api/simulate", () => {
  it("returns a schema-valid report for a valid request", async () => {
    const res = await post(JSON.stringify({ idea: IDEA }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(simulationReportSchema.safeParse(data.report).success).toBe(true);
    expect(["llm", "heuristic"]).toContain(data.engine);
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
});
