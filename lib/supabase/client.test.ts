import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSupabaseEnabled, supabaseConfig } from "./client";

const ORIGINAL = { ...process.env };

describe("supabaseConfig", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("is disabled without both env vars", () => {
    expect(supabaseConfig()).toBeNull();
    expect(isSupabaseEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    expect(isSupabaseEnabled()).toBe(false); // key still missing
  });

  it("is enabled when both env vars are present", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    expect(supabaseConfig()).toEqual({ url: "https://x.supabase.co", key: "anon-key" });
    expect(isSupabaseEnabled()).toBe(true);
  });
});
