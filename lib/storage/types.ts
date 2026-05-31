import type { SimulationEngine, SimulationInput, SimulationReport } from "../simulation/schema";

/**
 * A simulation the user chose to keep. Storing the input alongside the report
 * means we can fully restore the dashboard *and* re-run scenarios / action
 * plans from a saved item (those regenerate deterministically, so they don't
 * need to be persisted separately).
 */
export interface SavedSimulation {
  id: string;
  title: string;
  input: SimulationInput;
  report: SimulationReport;
  engine: SimulationEngine;
  /** ISO timestamp; sorts lexicographically in chronological order. */
  createdAt: string;
}

/** A record before the store assigns its `id` and `createdAt`. */
export type NewSavedSimulation = Omit<SavedSimulation, "id" | "createdAt">;

/**
 * Backend-agnostic persistence contract. Implemented by the browser
 * (localStorage) store today and the Supabase store when configured — the app
 * code only ever talks to this interface.
 */
export interface SimulationStore {
  /** Newest first. */
  list(): Promise<SavedSimulation[]>;
  save(record: NewSavedSimulation): Promise<SavedSimulation>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** Derives a compact, human-friendly title from the idea text. */
export function deriveTitle(idea: string): string {
  const t = idea.trim().replace(/\s+/g, " ");
  return t.length <= 60 ? t : t.slice(0, 57).trimEnd() + "…";
}
