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
  user_id?: string | null;
  created_at: string;
}

/** Thrown when a write needs an owner but nobody is signed in. */
export class NoSessionError extends Error {
  constructor() {
    super("Sign in to save simulations to Supabase.");
    this.name = "NoSessionError";
  }
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
export function recordToInsert(record: NewSavedSimulation, userId?: string) {
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
    ...(userId ? { user_id: userId } : {}),
  };
}

/** Resolves the signed-in user's id from the client's current session, or null. */
export async function currentUserId(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.auth.getSession();
  return data.session?.user?.id ?? null;
}

/**
 * Supabase-backed store. Every row is owned by the signed-in user: `save`
 * stamps `user_id` from the live session (and refuses without one), and the
 * RLS policies in migration 0002 make reads/deletes owner-only server-side —
 * the filters here are belt-and-braces, not the security boundary.
 */
export class SupabaseSimulationStore implements SimulationStore {
  constructor(private readonly client: SupabaseClient) {}

  private async requireUserId(): Promise<string> {
    const id = await currentUserId(this.client);
    if (!id) throw new NoSessionError();
    return id;
  }

  async list(): Promise<SavedSimulation[]> {
    const userId = await this.requireUserId();
    const { data, error } = await this.client
      .from(TABLE)
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data as SimulationRow[]).map(rowToRecord);
  }

  async save(record: NewSavedSimulation): Promise<SavedSimulation> {
    const userId = await this.requireUserId();
    const { data, error } = await this.client
      .from(TABLE)
      .insert(recordToInsert(record, userId))
      .select()
      .single();
    if (error) throw new Error(error.message);
    return rowToRecord(data as SimulationRow);
  }

  async remove(id: string): Promise<void> {
    const userId = await this.requireUserId();
    const { error } = await this.client.from(TABLE).delete().eq("id", id).eq("user_id", userId);
    if (error) throw new Error(error.message);
  }

  async clear(): Promise<void> {
    const userId = await this.requireUserId();
    const { error } = await this.client.from(TABLE).delete().eq("user_id", userId);
    if (error) throw new Error(error.message);
  }
}
