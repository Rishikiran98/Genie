"use client";

import { useState } from "react";
import {
  SCENARIO_TYPES,
  SCENARIOS,
  type ScenarioResult,
  type ScenarioType,
} from "@/lib/simulation/scenario";
import type { SimulationInput, SimulationReport } from "@/lib/simulation/schema";

interface ScenarioPanelProps {
  input: SimulationInput;
  baseScores: SimulationReport["scores"];
}

const SCORE_LABELS: { key: keyof SimulationReport["scores"]; label: string }[] = [
  { key: "desirability", label: "Desirability" },
  { key: "feasibility", label: "Feasibility" },
  { key: "differentiation", label: "Differentiation" },
  { key: "executionRisk", label: "Execution Risk" },
  { key: "confidence", label: "Confidence" },
];

function Delta({ from, to }: { from: number; to: number }) {
  const diff = to - from;
  if (diff === 0) return <span className="text-slate-500">±0</span>;
  const up = diff > 0;
  return (
    <span className={up ? "text-genie-good" : "text-genie-bad"}>
      {up ? "▲" : "▼"} {Math.abs(diff)}
    </span>
  );
}

export function ScenarioPanel({ input, baseScores }: ScenarioPanelProps) {
  const [active, setActive] = useState<ScenarioType | null>(null);
  const [loading, setLoading] = useState<ScenarioType | null>(null);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(type: ScenarioType) {
    setActive(type);
    setLoading(type);
    setError(null);
    try {
      const res = await fetch("/api/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, scenario: type }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setResult(null);
      } else {
        setResult(data as ScenarioResult);
      }
    } catch {
      setError("Could not reach Genie. Check your connection and try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Simulate a scenario</h2>
        <p className="mt-1 text-sm text-slate-400">
          Replay the idea through different lenses and see how outcomes shift.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SCENARIO_TYPES.map((type) => {
          const meta = SCENARIOS[type];
          const isActive = active === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => pick(type)}
              disabled={loading !== null}
              className={`rounded-xl p-3 text-left text-sm ring-1 transition disabled:opacity-60 ${
                isActive
                  ? "bg-genie-accent/15 ring-genie-accent/60"
                  : "bg-genie-card ring-white/10 hover:ring-white/25"
              }`}
            >
              <div className="font-medium text-slate-100">{meta.label}</div>
              <div className="mt-0.5 text-xs text-slate-400">
                {loading === type ? "Simulating…" : meta.question}
              </div>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="rounded-xl border border-genie-bad/40 bg-genie-bad/10 p-4 text-sm text-genie-bad">{error}</p>
      )}

      {result && (
        <div className="space-y-4 rounded-xl bg-genie-card p-5 ring-1 ring-white/5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-100">{result.report.label}</h3>
            <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-400 ring-1 ring-white/10">
              {result.engine === "llm" ? "LLM engine" : "Offline engine"}
            </span>
          </div>

          <p className="text-sm leading-relaxed text-slate-200">{result.report.narrative}</p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {SCORE_LABELS.map(({ key, label }) => (
              <div key={key} className="rounded-lg bg-white/5 p-3 ring-1 ring-white/5">
                <div className="text-xs text-slate-400">{label}</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-xl font-bold tabular-nums text-slate-100">
                    {result.report.scores[key]}
                  </span>
                  <span className="text-xs font-medium">
                    <Delta from={baseScores[key]} to={result.report.scores[key]} />
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-genie-accent">What drives this</h4>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-slate-200">
                {result.report.keyFactors.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-genie-accent">What to do</h4>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-slate-200">
                {result.report.moves.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
