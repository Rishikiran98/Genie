import { afterEach, describe, expect, it, vi } from "vitest";
import { readSupabaseConfig, storeBackend } from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readSupabaseConfig / storeBackend", () => {
  it("requires both public settings", () => {
    expect(readSupabaseConfig({})).toBeNull();
    expect(readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://x" })).toBeNull();
    expect(readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://x", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toEqual({
      url: "https://x",
      key: "k",
    });
    expect(storeBackend({})).toBe("local");
  });
});

describe("getStore", () => {
  it("returns the browser store when Supabase is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const map = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
      },
    });
    const { getStore } = await import("./index");
    const store = await getStore();
    expect(await store.list()).toEqual([]);
    await store.save({
      title: "t",
      input: { idea: "A newsletter summarizing research papers" },
      report: (await import("../simulation/heuristic")).heuristicSimulation({
        idea: "A newsletter summarizing research papers",
      }),
      engine: "heuristic",
    });
    expect(map.has("genie.savedSimulations.v1")).toBe(true);
  });
});
