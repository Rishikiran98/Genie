import { getBrowserClient, isSupabaseEnabled } from "../supabase/client";
import { LocalSimulationStore } from "./local";
import type { SimulationStore } from "./types";

export * from "./types";

/**
 * Picks the active store for the current session:
 *   - Supabase, when it's configured AND the user is signed in (rows are
 *     scoped to the user via RLS).
 *   - Browser localStorage otherwise — including signed-out users, so saving
 *     still works before you log in.
 *
 * Not memoized: it re-evaluates each call so the backend follows the auth
 * state (the UI reloads the saved list when the user signs in or out).
 */
export async function getStore(): Promise<SimulationStore> {
  if (isSupabaseEnabled()) {
    try {
      const client = await getBrowserClient();
      const { data } = await client.auth.getSession();
      if (data.session) {
        const { SupabaseSimulationStore } = await import("./supabase");
        return new SupabaseSimulationStore(client);
      }
    } catch (err) {
      console.warn("Genie Supabase store unavailable; falling back to local storage:", err);
    }
  }

  if (typeof window !== "undefined") {
    return new LocalSimulationStore(window.localStorage);
  }

  throw new Error("No storage backend is available in this environment.");
}
