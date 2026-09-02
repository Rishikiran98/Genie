"use client";

import { useCallback, useEffect, useState } from "react";
import { getStore, type SavedSimulation } from "@/lib/storage";

interface SavedSimulationsProps {
  /** Bump to trigger a reload (e.g. after the page saves a new item). */
  refreshKey: number;
  onOpen: (saved: SavedSimulation) => void;
}

const SCORE_KEYS: { key: keyof SavedSimulation["report"]["scores"]; label: string }[] = [
  { key: "desirability", label: "Desir" },
  { key: "feasibility", label: "Feas" },
  { key: "differentiation", label: "Diff" },
  { key: "executionRisk", label: "Risk" },
  { key: "confidence", label: "Conf" },
];

function scoreTone(v: number): string {
  if (v >= 66) return "text-genie-good";
  if (v >= 40) return "text-genie-warn";
  return "text-genie-bad";
}

export function SavedSimulations({ refreshKey, onOpen }: SavedSimulationsProps) {
  const [items, setItems] = useState<SavedSimulation[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const store = await getStore();
    setItems(await store.list());
    setLoaded(true);
  }, []);

  useEffect(() => {
    reload().catch(() => setLoaded(true));
  }, [reload, refreshKey]);

  async function remove(id: string) {
    const store = await getStore();
    await store.remove(id);
    await reload();
  }

  if (!loaded || items.length === 0) return null;

  return (
    <div className="mt-12 space-y-4 border-t border-white/10 pt-10">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Saved simulations</h2>
        <span className="text-xs text-slate-500">{items.length} saved · scores shown for comparison</span>
      </div>

      <ul className="space-y-2">
        {items.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center gap-3 rounded-xl bg-genie-card p-4 ring-1 ring-white/5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-slate-100">{s.title}</span>
                {s.decision === "BUILD" && (
                  <span className="rounded bg-genie-good/20 px-1.5 py-0.5 text-[10px] font-semibold text-genie-good">
                    BUILD
                  </span>
                )}
                {s.decision === "DONT_BUILD" && (
                  <span className="rounded bg-genie-bad/20 px-1.5 py-0.5 text-[10px] font-semibold text-genie-bad">
                    DON&apos;T BUILD
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500">{new Date(s.createdAt).toLocaleString()}</div>
            </div>

            <div className="flex gap-2 sm:gap-3">
              {SCORE_KEYS.map(({ key, label }) => (
                <div key={key} className="text-center">
                  <div className="text-[10px] uppercase text-slate-500">{label}</div>
                  <div className={`text-sm font-bold tabular-nums ${scoreTone(s.report.scores[key])}`}>
                    {s.report.scores[key]}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOpen(s)}
                className="rounded-lg bg-genie-accent/15 px-3 py-1.5 text-xs font-medium text-genie-accent ring-1 ring-genie-accent/40 transition hover:bg-genie-accent/25"
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => remove(s.id)}
                className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-400 ring-1 ring-white/10 transition hover:text-genie-bad"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
