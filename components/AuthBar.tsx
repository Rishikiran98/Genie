"use client";

import { useAuth } from "./AuthProvider";

/**
 * Top-of-page auth strip. Renders nothing when Supabase auth isn't configured
 * (the app runs in local-only mode). Otherwise shows sign-in buttons or the
 * signed-in user with a sign-out control.
 */
export function AuthBar() {
  const { enabled, ready, user, signIn, signOut } = useAuth();

  if (!enabled) return null;

  return (
    <div className="mb-6 flex min-h-9 items-center justify-end gap-2 text-sm">
      {!ready ? (
        <span className="text-slate-500">…</span>
      ) : user ? (
        <>
          <span className="text-slate-400">{user.email ?? "Signed in"}</span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10"
          >
            Sign out
          </button>
        </>
      ) : (
        <>
          <span className="mr-1 text-xs text-slate-500">Sign in to sync your saves across devices</span>
          <button
            type="button"
            onClick={() => void signIn("google")}
            className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/10 transition hover:bg-white/10"
          >
            Google
          </button>
          <button
            type="button"
            onClick={() => void signIn("github")}
            className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/10 transition hover:bg-white/10"
          >
            GitHub
          </button>
        </>
      )}
    </div>
  );
}
