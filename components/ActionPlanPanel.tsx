"use client";

import { useState } from "react";
import type { ActionPlanResult } from "@/lib/simulation/actionplan";

interface ActionPlanPanelProps {
  input: { idea: string; audience?: string; timeline?: string };
}

/** A checklist whose items can be ticked off locally for a sense of progress. */
function Checklist({ items }: { items: string[] }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setDone((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  return (
    <ul className="space-y-2">
      {items.map((item, i) => {
        const checked = done.has(i);
        return (
          <li key={i}>
            <button
              type="button"
              onClick={() => toggle(i)}
              className="flex w-full items-start gap-2 text-left text-sm text-slate-200"
            >
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                  checked ? "border-genie-good bg-genie-good/20 text-genie-good" : "border-white/25 text-transparent"
                }`}
              >
                ✓
              </span>
              <span className={checked ? "text-slate-500 line-through" : ""}>{item}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ActionPlanPanel({ input }: ActionPlanPanelProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ActionPlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/actionplan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setResult(null);
      } else {
        setResult(data as ActionPlanResult);
      }
    } catch {
      setError("Could not reach Genie. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Action plan</h2>
          <p className="mt-1 text-sm text-slate-400">Turn this into a day-by-day plan you can start tomorrow.</p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="rounded-xl bg-genie-accent px-4 py-2 text-sm font-semibold text-genie-bg transition hover:brightness-110 disabled:opacity-50"
        >
          {loading ? "Generating…" : result ? "Regenerate plan" : "Generate action plan"}
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-genie-bad/40 bg-genie-bad/10 p-4 text-sm text-genie-bad">{error}</p>
      )}

      {result && (
        <div className="space-y-6">
          <p className="rounded-xl bg-genie-card p-5 text-sm leading-relaxed text-slate-200 ring-1 ring-white/5">
            {result.report.overview}
          </p>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-genie-accent">First week, day by day</h3>
            <ol className="mt-3 space-y-3">
              {result.report.dailyPlan.map((d) => (
                <li key={d.day} className="rounded-xl bg-genie-card p-4 ring-1 ring-white/5">
                  <div className="flex items-baseline gap-3">
                    <span className="rounded-md bg-genie-accent/15 px-2 py-0.5 text-xs font-semibold text-genie-accent">
                      Day {d.day}
                    </span>
                    <span className="text-sm font-medium text-slate-100">{d.focus}</span>
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
                    {d.tasks.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-genie-accent">30-day roadmap</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {result.report.roadmap.map((m, i) => (
                <div key={i} className="rounded-xl bg-genie-card p-4 ring-1 ring-white/5">
                  <div className="text-xs font-semibold text-genie-accent">{m.window}</div>
                  <div className="mt-1 text-sm font-medium text-slate-100">{m.goal}</div>
                  <div className="mt-1 text-xs text-slate-400">{m.deliverable}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl bg-genie-card p-5 ring-1 ring-white/5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-genie-accent">Build checklist</h3>
              <div className="mt-3">
                <Checklist items={result.report.buildChecklist} />
              </div>
            </div>
            <div className="rounded-xl bg-genie-card p-5 ring-1 ring-white/5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-genie-accent">Validation checklist</h3>
              <div className="mt-3">
                <Checklist items={result.report.validationChecklist} />
              </div>
            </div>
          </div>

          <p className="text-right text-xs text-slate-500">
            {result.engine === "llm" ? "LLM engine" : "Offline engine"}
          </p>
        </div>
      )}
    </div>
  );
}
