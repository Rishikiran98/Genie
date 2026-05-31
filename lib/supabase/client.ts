import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns the public Supabase config when both env vars are present, else null.
 * NEXT_PUBLIC_* values are inlined at build time, so this is safe on server and
 * client. A null result is the signal to run in local-only mode.
 */
export function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}

export function isSupabaseEnabled(): boolean {
  return supabaseConfig() !== null;
}

let clientPromise: Promise<SupabaseClient> | null = null;

/**
 * Lazily creates a single browser Supabase client (memoized). The dynamic
 * import keeps @supabase/supabase-js out of the bundle entirely when Supabase
 * isn't configured. Uses the PKCE flow so OAuth redirects are exchanged for a
 * session automatically on return to the app.
 */
export async function getBrowserClient(): Promise<SupabaseClient> {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error("Supabase is not configured.");
  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(cfg.url, cfg.key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce",
        },
      }),
    );
  }
  return clientPromise;
}
