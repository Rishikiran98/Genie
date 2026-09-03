import { afterEach, describe, expect, it, vi } from "vitest";
import { scenarioReportSchema } from "@/lib/simulation/scenario";
import { POST } from "./route";

const IDEA = "A subscription budgeting app for freelancers with irregular monthly income.";

let ipCounter = 0;
function post(body: unknown, ip = `203.0.113.${++ipCounter}`) {
  return POST(
    new Request("http://genie.test/api/scenario", {
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

describe("POST /api/scenario", () => {
  it("returns a schema-valid scenario report", async () => {
    delete process.env.GENIE_LLM_API_KEY;
    const res = await post({ idea: IDEA, scenario: "pessimistic" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(scenarioReportSchema.safeParse(data.report).success).toBe(true);
    expect(data.report.scenarioType).toBe("pessimistic");
    expect(data.engine).toBe("heuristic");
  });

  it("rejects an unknown scenario with 400 and issues", async () => {
    const res = await post({ idea: IDEA, scenario: "sideways" });
    expect(res.status).toBe(400);
    expect((await res.json()).issues[0].path).toEqual(["scenario"]);
  });

  it("rejects malformed JSON with 400", async () => {
    expect((await post("nope")).status).toBe(400);
  });

  it("falls back to the heuristic engine when the configured LLM times out", async () => {
    process.env.GENIE_LLM_API_KEY = "test-key";
    process.env.GENIE_LLM_TIMEOUT_MS = "20";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    );

    const res = await post({ idea: IDEA, scenario: "fast" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.engine).toBe("heuristic");
    expect(data.report.scenarioType).toBe("fast");
  });
});
