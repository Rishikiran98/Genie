import { log, serializeError } from "../log";
import { LocalSimulationStore } from "./local";
import type { SimulationStore } from "./types";

export * from "./types";

let cached: Promise<SimulationStore> | null = null;

/** Reads the public Supabase settings; both must be present to opt in. */
export function readSupabaseConfig(
  env: Record<string, string | undefined> = process.env,
): { url: string; key: string } | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && key ? { url, key } : null;
}

/** Which backend `getStore()` will pick, without initializing anything. */
export function storeBackend(env: Record<string, string | undefined> = process.env): "supabase" | "local" {
  return readSupabaseConfig(env) ? "supabase" : "local";
}

async function create(): Promise<SimulationStore> {
  // Read via the literal `process.env.NEXT_PUBLIC_*` form so Next.js can inline
  // the values into the client bundle.
  const supabase = readSupabaseConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  // Use Supabase when configured; the import is dynamic so the client library
  // never lands in the bundle for the default (local) setup.
  if (supabase) {
    const { url, key } = supabase;
    try {
      const [{ createClient }, { SupabaseSimulationStore }] = await Promise.all([
        import("@supabase/supabase-js"),
        import("./supabase"),
      ]);
      return new SupabaseSimulationStore(createClient(url, key));
    } catch (err) {
      log.warn("storage.fallback", { from: "supabase", to: "local", ...serializeError(err) });
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
