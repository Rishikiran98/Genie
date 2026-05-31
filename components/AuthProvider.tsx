"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getBrowserClient, isSupabaseEnabled } from "@/lib/supabase/client";

export type OAuthProvider = "google" | "github";

export interface AuthUser {
  id: string;
  email?: string;
}

interface AuthState {
  /** Whether Supabase auth is configured at all. */
  enabled: boolean;
  /** False until the initial session check completes. */
  ready: boolean;
  user: AuthUser | null;
  signIn: (provider: OAuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>.");
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const enabled = isSupabaseEnabled();
  // When auth is disabled, there's nothing to wait for.
  const [ready, setReady] = useState(!enabled);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let unsubscribe: (() => void) | undefined;

    getBrowserClient()
      .then(async (client) => {
        const { data } = await client.auth.getUser();
        setUser(data.user ? { id: data.user.id, email: data.user.email ?? undefined } : null);
        setReady(true);

        // Strip the OAuth `?code=` / `?error=` params left after the redirect.
        if (typeof window !== "undefined" && /[?&](code|error)=/.test(window.location.search)) {
          window.history.replaceState({}, "", window.location.pathname);
        }

        const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
          setUser(session?.user ? { id: session.user.id, email: session.user.email ?? undefined } : null);
        });
        unsubscribe = () => sub.subscription.unsubscribe();
      })
      .catch(() => setReady(true));

    return () => unsubscribe?.();
  }, [enabled]);

  const signIn = useCallback(async (provider: OAuthProvider) => {
    const client = await getBrowserClient();
    await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: typeof window !== "undefined" ? window.location.origin : undefined },
    });
  }, []);

  const signOut = useCallback(async () => {
    const client = await getBrowserClient();
    await client.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ enabled, ready, user, signIn, signOut }}>{children}</AuthContext.Provider>
  );
}
