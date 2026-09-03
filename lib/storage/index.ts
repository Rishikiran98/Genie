import type { SupabaseClient } from "@supabase/supabase-js";
import { log, serializeError } from "../log";
import { LocalSimulationStore } from "./local";
import type { SimulationStore } from "./types";

export * from "./types";

/** Reads the public Supabase settings; both must be present to opt in. */
export function readSupabaseConfig(
  env: Record<string, string | undefined> = process.env,
): { url: string; key: string } | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && key ? { url, key } : null;
}

/** Which backend `getStore()` will pick for a signed-in user, without initializing anything. */
export function storeBackend(env: Record<string, string | undefined> = process.env): "supabase" | "local" {
  return readSupabaseConfig(env) ? "supabase" : "local";
}

/** The public Supabase settings as inlined into the client bundle by Next.js. */
function publicSupabaseConfig() {
  // Must reference the literal `process.env.NEXT_PUBLIC_*` names for inlining.
  return readSupabaseConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

let clientPromise: Promise<SupabaseClient | null> | null = null;

/**
 * The shared browser Supabase client, or null when Supabase is not configured
 * or the library fails to load. The import is dynamic so the client library
 * never lands in the bundle for the default (local) setup.
 */
export function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const config = publicSupabaseConfig();
      if (!config) return null;
      try {
        const { createClient } = await import("@supabase/supabase-js");
        return createClient(config.url, config.key);
      } catch (err) {
        log.warn("storage.fallback", { from: "supabase", to: "local", reason: "client_init", ...serializeError(err) });
        return null;
      }
    })();
  }
  return clientPromise;
}

function localStore(): SimulationStore {
  if (typeof window !== "undefined") {
    return new LocalSimulationStore(window.localStorage);
  }
  throw new Error("No storage backend is available in this environment.");
}

/**
 * Returns the store for the current moment: Supabase when it is configured
 * AND the user is signed in, otherwise browser storage. Signed-out or
 * unconfigured users get exactly the zero-config behaviour. Resolved on every
 * call (cheap — the session check reads local state) so signing in or out
 * switches backends without a reload.
 */
export async function getStore(): Promise<SimulationStore> {
  const client = await getSupabaseClient();
  if (!client) return localStore();

  const { SupabaseSimulationStore, currentUserId } = await import("./supabase");
  const userId = await currentUserId(client).catch(() => null);
  if (!userId) {
    log.debug("storage.fallback", { from: "supabase", to: "local", reason: "no_session" });
    return localStore();
  }
  return new SupabaseSimulationStore(client);
}
