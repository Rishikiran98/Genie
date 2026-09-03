import { afterEach, describe, expect, it, vi } from "vitest";
import { actionPlanSchema } from "@/lib/simulation/actionplan";
import { POST } from "./route";

const IDEA = "A newsletter that summarizes one research paper a day for software engineers.";

let ipCounter = 0;
function post(body: unknown, ip = `203.0.113.${++ipCounter}`) {
  return POST(
    new Request("http://genie.test/api/actionplan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  vi.unstubAllGlobals();
});

describe("POST /api/actionplan", () => {
  it("returns a schema-valid 7-day plan", async () => {
    delete process.env.GENIE_LLM_API_KEY;
    const res = await post({ idea: IDEA, timeline: "2 weeks" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(actionPlanSchema.safeParse(data.report).success).toBe(true);
    expect(data.report.dailyPlan).toHaveLength(7);
    expect(data.engine).toBe("heuristic");
  });

  it("rejects a missing idea with 400 and issues", async () => {
    const res = await post({ timeline: "2 weeks" });
    expect(res.status).toBe(400);
    expect((await res.json()).issues[0].path).toEqual(["idea"]);
  });

  it("falls back to the heuristic engine when the LLM returns an invalid plan", async () => {
    process.env.GENIE_LLM_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{"overview":"only this"}' } }] }), {
          status: 200,
        }),
      ),
    );

    const res = await post({ idea: IDEA });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.engine).toBe("heuristic");
    expect(actionPlanSchema.safeParse(data.report).success).toBe(true);
  });
});
