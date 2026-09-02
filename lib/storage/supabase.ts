import type { SupabaseClient } from "@supabase/supabase-js";
import type { SimulationReport } from "../simulation/schema";
import type { NewSavedSimulation, SavedSimulation, SimulationStore } from "./types";

const TABLE = "simulations";

interface SimulationRow {
  id: string;
  title: string;
  idea: string;
  target_user?: string | null;
  goal?: string | null;
  constraints?: string | null;
  timeline: string | null;
  audience: string | null;
  evidence?: string | null;
  engine: string;
  report: SimulationReport;
  decision?: string | null;
  created_at: string;
}

/** Maps a database row to the app's record shape. Pure — unit-tested directly. */
export function rowToRecord(row: SimulationRow): SavedSimulation {
  return {
    id: row.id,
    title: row.title,
    input: {
      idea: row.idea,
      targetUser: row.target_user ?? row.audience ?? undefined,
      goal: row.goal ?? undefined,
      constraints: row.constraints ?? undefined,
      timeline: row.timeline ?? undefined,
      audience: row.audience ?? undefined,
      evidence: row.evidence ?? undefined,
    },
    report: row.report,
    engine: row.engine === "llm" ? "llm" : "heuristic",
    decision: row.decision === "BUILD" || row.decision === "DONT_BUILD" ? row.decision : undefined,
    createdAt: row.created_at,
  };
}

/** Maps a record to an insert payload, also populating queryable columns. */
export function recordToInsert(record: NewSavedSimulation) {
  return {
    title: record.title,
    idea: record.input.idea,
    target_user: record.input.targetUser ?? record.input.audience ?? null,
    goal: record.input.goal ?? null,
    constraints: record.input.constraints ?? null,
    timeline: record.input.timeline ?? null,
    evidence: record.input.evidence ?? null,
    engine: record.engine,
    desirability_score: record.report.scores.desirability,
    feasibility_score: record.report.scores.feasibility,
    differentiation_score: record.report.scores.differentiation,
    execution_risk_score: record.report.scores.executionRisk,
    confidence_score: record.report.scores.confidence,
    summary: record.report.summary,
    recommendation: record.report.recommendation,
    report: record.report,
    decision: record.decision ?? null,
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
