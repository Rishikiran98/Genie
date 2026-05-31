import { LocalSimulationStore } from "./local";
import type { SimulationStore } from "./types";

export * from "./types";

let cached: Promise<SimulationStore> | null = null;

async function create(): Promise<SimulationStore> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Use Supabase when configured; the import is dynamic so the client library
  // never lands in the bundle for the default (local) setup.
  if (url && key) {
    try {
      const [{ createClient }, { SupabaseSimulationStore }] = await Promise.all([
        import("@supabase/supabase-js"),
        import("./supabase"),
      ]);
      return new SupabaseSimulationStore(createClient(url, key));
    } catch (err) {
      console.warn("Genie Supabase store unavailable; falling back to local storage:", err);
    }
  }

  if (typeof window !== "undefined") {
    return new LocalSimulationStore(window.localStorage);
  }

  throw new Error("No storage backend is available in this environment.");
}

/** Returns the active store for this session (memoized). */
export function getStore(): Promise<SimulationStore> {
  if (!cached) cached = create();
  return cached;
}
