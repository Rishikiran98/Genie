"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/storage";

interface AuthPanelProps {
  /** Called whenever the session changes so the page can reload saved items from the right backend. */
  onAuthChange: () => void;
}

/**
 * Magic-link sign-in. Renders nothing unless Supabase is configured, so the
 * zero-config (localStorage) setup is visually unchanged. Signed-out users keep
 * browser storage; signing in switches saved simulations to their own rows.
 */
export function AuthPanel({ onAuthChange }: AuthPanelProps) {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [email, setEmail] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "sending" | "sent" | "error"; message?: string }>({
    kind: "idle",
  });

  useEffect(() => {
    let unsubscribe = () => {};
    getSupabaseClient().then((c) => {
      if (!c) return;
      setClient(c);
      c.auth.getSession().then(({ data }) => setUserEmail(data.session?.user.email ?? null));
      const { data } = c.auth.onAuthStateChange((_event, session) => {
        setUserEmail(session?.user.email ?? null);
        onAuthChange();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    });
    return () => unsubscribe();
  }, [onAuthChange]);

  if (!client) return null;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    if (!client) return;
    setStatus({ kind: "sending" });
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setStatus(error ? { kind: "error", message: error.message } : { kind: "sent" });
  }

  async function signOut() {
    await client?.auth.signOut();
  }

  if (userEmail) {
    return (
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-genie-card px-4 py-3 text-xs ring-1 ring-white/10">
        <span className="text-slate-400">
          Signed in as <span className="text-slate-200">{userEmail}</span> · saved simulations sync to your account
        </span>
        <button
          type="button"
          onClick={signOut}
          className="rounded-lg bg-white/5 px-3 py-1.5 text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={sendLink}
      className="mt-6 flex flex-wrap items-center gap-2 rounded-xl bg-genie-card px-4 py-3 text-xs ring-1 ring-white/10"
    >
      <span className="text-slate-400">Sign in to keep saved simulations across devices:</span>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="min-w-0 flex-1 rounded-lg bg-genie-bg px-3 py-1.5 text-slate-100 placeholder:text-slate-500 ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-genie-accent"
      />
      <button
        type="submit"
        disabled={status.kind === "sending"}
        className="rounded-lg bg-genie-accent/15 px-3 py-1.5 font-medium text-genie-accent ring-1 ring-genie-accent/40 transition hover:bg-genie-accent/25 disabled:opacity-50"
      >
        {status.kind === "sending" ? "Sending…" : "Email me a link"}
      </button>
      {status.kind === "sent" && <span className="w-full text-genie-good">Check your inbox for the sign-in link.</span>}
      {status.kind === "error" && <span className="w-full text-genie-bad">{status.message}</span>}
    </form>
  );
}
