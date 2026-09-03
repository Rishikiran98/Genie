import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe("GET /api/health", () => {
  it("reports ok with nothing configured", async () => {
    delete process.env.GENIE_LLM_API_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", llmConfigured: false, store: "local" });
  });

  it("reflects configuration without leaking values", async () => {
    process.env.GENIE_LLM_API_KEY = "sk-secret";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    const res = await GET();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "ok", llmConfigured: true, store: "supabase" });
    expect(text).not.toContain("sk-secret");
    expect(text).not.toContain("anon");
  });
});
