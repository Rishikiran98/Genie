import type { SupabaseClient } from "@supabase/supabase-js";
import type { SimulationReport } from "../simulation/schema";
import type { NewSavedSimulation, SavedSimulation, SimulationStore } from "./types";

/**
 * Supabase (Postgres) store. Ready to use, but inactive until both
 * NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set AND the
 * migration in `supabase/migrations/` has been applied to the project.
 * See the README before enabling — multi-user use needs auth + RLS.
 */
const TABLE = "simulations";

interface SimulationRow {
  id: string;
  title: string;
  idea: string;
  audience: string | null;
  timeline: string | null;
  engine: string;
  report: SimulationReport;
  created_at: string;
}

/** Maps a database row to the app's record shape. Pure — unit-tested directly. */
export function rowToRecord(row: SimulationRow): SavedSimulation {
  return {
    id: row.id,
    title: row.title,
    input: {
      idea: row.idea,
      audience: row.audience ?? undefined,
      timeline: row.timeline ?? undefined,
    },
    report: row.report,
    engine: row.engine === "llm" ? "llm" : "heuristic",
    createdAt: row.created_at,
  };
}

/** Maps a record to an insert payload, also populating the queryable columns. */
export function recordToInsert(record: NewSavedSimulation) {
  return {
    title: record.title,
    idea: record.input.idea,
    audience: record.input.audience ?? null,
    timeline: record.input.timeline ?? null,
    engine: record.engine,
    practicality_score: record.report.scores.practicality,
    opportunity_score: record.report.scores.opportunity,
    clarity_score: record.report.scores.clarity,
    risk_score: record.report.scores.risk,
    summary: record.report.summary,
    recommendation: record.report.recommendation,
    report: record.report,
  };
}

export class SupabaseSimulationStore implements SimulationStore {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<SavedSimulation[]> {
    const { data, error } = await this.client
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data as SimulationRow[]).map(rowToRecord);
  }

  async save(record: NewSavedSimulation): Promise<SavedSimulation> {
    const { data, error } = await this.client.from(TABLE).insert(recordToInsert(record)).select().single();
    if (error) throw new Error(error.message);
    return rowToRecord(data as SimulationRow);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client.from(TABLE).delete().eq("id", id);
    if (error) throw new Error(error.message);
  }

  async clear(): Promise<void> {
    const { error } = await this.client.from(TABLE).delete().not("id", "is", null);
    if (error) throw new Error(error.message);
  }
}
