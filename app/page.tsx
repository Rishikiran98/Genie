"use client";

import { useState } from "react";
import { SimulationDashboard } from "@/components/SimulationDashboard";
import { ScenarioPanel } from "@/components/ScenarioPanel";
import { ActionPlanPanel } from "@/components/ActionPlanPanel";
import { SavedSimulations } from "@/components/SavedSimulations";
import { deriveTitle, getStore, type SavedSimulation } from "@/lib/storage";
import type { SimulationResult } from "@/lib/simulation/schema";

const EXAMPLES = [
  "An AI agent that helps people prepare for job interviews with realistic mock questions.",
  "A subscription budgeting app for freelancers with irregular monthly income.",
  "A marketplace connecting local home cooks with busy neighbours who want home-cooked meals.",
  "A newsletter that summarizes one research paper a day for software engineers.",
];

export default function Home() {
  const [idea, setIdea] = useState("");
  const [audience, setAudience] = useState("");
  const [timeline, setTimeline] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [submitted, setSubmitted] = useState<{ idea: string; audience?: string; timeline?: string } | null>(null);
  const [savedRefresh, setSavedRefresh] = useState(0);
  const [savedThis, setSavedThis] = useState(false);

  async function simulate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload = {
        idea,
        audience: audience || undefined,
        timeline: timeline || undefined,
      };
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setResult(null);
        setSubmitted(null);
      } else {
        setResult(data as SimulationResult);
        setSubmitted(payload);
        setSavedThis(false);
      }
    } catch {
      setError("Could not reach Genie. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function saveCurrent() {
    if (!result || !submitted) return;
    const store = await getStore();
    await store.save({
      title: deriveTitle(submitted.idea),
      input: submitted,
      report: result.report,
      engine: result.engine,
    });
    setSavedThis(true);
    setSavedRefresh((n) => n + 1);
  }

  function openSaved(saved: SavedSimulation) {
    setIdea(saved.input.idea);
    setAudience(saved.input.audience ?? "");
    setTimeline(saved.input.timeline ?? "");
    setSubmitted(saved.input);
    setResult({ report: saved.report, engine: saved.engine });
    setSavedThis(true);
    setError(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-slate-50">Genie</h1>
        <p className="mt-3 text-balance text-slate-300">
          Test ideas before you waste time building them. Describe a goal, idea, plan, or decision —
          Genie simulates it into a clear, scored, practical report.
        </p>
      </header>

      <form onSubmit={simulate} className="mt-10 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-300">What are you trying to figure out?</span>
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={4}
            placeholder="e.g. I want to build an AI agent that helps people prepare for interviews…"
            className="mt-2 w-full resize-y rounded-xl bg-genie-card p-4 text-slate-100 placeholder:text-slate-500 ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-genie-accent"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="Target audience (optional)"
            className="rounded-xl bg-genie-card p-3 text-sm text-slate-100 placeholder:text-slate-500 ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-genie-accent"
          />
          <input
            value={timeline}
            onChange={(e) => setTimeline(e.target.value)}
            placeholder="Timeline / constraints (optional)"
            className="rounded-xl bg-genie-card p-3 text-sm text-slate-100 placeholder:text-slate-500 ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-genie-accent"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setIdea(ex)}
              className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10"
            >
              {ex.length > 48 ? ex.slice(0, 48) + "…" : ex}
            </button>
          ))}
        </div>

        <button
          type="submit"
          disabled={loading || idea.trim().length < 8}
          className="w-full rounded-xl bg-genie-accent py-3 font-semibold text-genie-bg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Simulating…" : "Simulate this idea"}
        </button>
      </form>

      {error && (
        <p className="mt-6 rounded-xl border border-genie-bad/40 bg-genie-bad/10 p-4 text-sm text-genie-bad">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-10">
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={saveCurrent}
              disabled={savedThis}
              className="rounded-xl bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-50"
            >
              {savedThis ? "Saved ✓" : "Save simulation"}
            </button>
          </div>
          <SimulationDashboard result={result} />
        </div>
      )}

      {result && submitted && (
        <div className="mt-12 border-t border-white/10 pt-10">
          <ScenarioPanel key={submitted.idea} input={submitted} baseScores={result.report.scores} />
        </div>
      )}

      {result && submitted && (
        <div className="mt-12 border-t border-white/10 pt-10">
          <ActionPlanPanel key={submitted.idea} input={submitted} />
        </div>
      )}

      <SavedSimulations refreshKey={savedRefresh} onOpen={openSaved} />
    </main>
  );
}
