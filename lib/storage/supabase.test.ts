import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { heuristicSimulation } from "../simulation/heuristic";
import { NoSessionError, SupabaseSimulationStore, currentUserId, recordToInsert } from "./supabase";
import { deriveTitle, type NewSavedSimulation } from "./types";

const USER = "11111111-1111-1111-1111-111111111111";

const record = (idea: string): NewSavedSimulation => ({
  title: deriveTitle(idea),
  input: { idea },
  report: heuristicSimulation({ idea }),
  engine: "heuristic",
});

/**
 * A minimal stand-in for the supabase-js client: records every query-builder
 * call and resolves to a canned result, so the store's behaviour with and
 * without a session can be asserted without a network.
 */
function fakeClient(sessionUserId: string | null, result: { data?: unknown; error?: { message: string } | null } = {}) {
  const ops: [string, unknown[]][] = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "insert", "eq", "order", "delete", "single"]) {
    q[m] = (...args: unknown[]) => {
      ops.push([m, args]);
      return q;
    };
  }
  q.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(resolve, reject);

  const client = {
    auth: {
      getSession: async () => ({ data: { session: sessionUserId ? { user: { id: sessionUserId } } : null } }),
    },
    from: (table: string) => {
      ops.push(["from", [table]]);
      return q;
    },
  } as unknown as SupabaseClient;

  return { client, ops };
}

describe("currentUserId", () => {
  it("returns the session user id or null", async () => {
    expect(await currentUserId(fakeClient(USER).client)).toBe(USER);
    expect(await currentUserId(fakeClient(null).client)).toBeNull();
  });
});

describe("recordToInsert", () => {
  it("stamps user_id only when given", () => {
    const rec = record("A tool that drafts cover letters for job seekers");
    expect(recordToInsert(rec)).not.toHaveProperty("user_id");
    expect(recordToInsert(rec, USER).user_id).toBe(USER);
  });
});

describe("SupabaseSimulationStore with a session", () => {
  const row = {
    id: "row-1",
    title: "t",
    idea: "An AI tool that drafts cover letters for job seekers",
    audience: null,
    timeline: null,
    engine: "heuristic",
    report: heuristicSimulation({ idea: "An AI tool that drafts cover letters for job seekers" }),
    user_id: USER,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  it("stamps the signed-in user's id on save", async () => {
    const { client, ops } = fakeClient(USER, { data: row });
    const saved = await new SupabaseSimulationStore(client).save(record(row.idea));
    const insert = ops.find(([m]) => m === "insert")!;
    expect((insert[1][0] as { user_id: string }).user_id).toBe(USER);
    expect(saved.id).toBe("row-1");
  });

  it("scopes list, remove and clear to the user", async () => {
    const { client, ops } = fakeClient(USER, { data: [row] });
    const store = new SupabaseSimulationStore(client);
    expect((await store.list()).map((r) => r.id)).toEqual(["row-1"]);
    await store.remove("row-1");
    await store.clear();
    const eqs = ops.filter(([m]) => m === "eq").map(([, args]) => args);
    expect(eqs).toContainEqual(["user_id", USER]);
    expect(eqs.filter(([col]) => col === "user_id")).toHaveLength(3);
    expect(eqs).toContainEqual(["id", "row-1"]);
  });

  it("surfaces database errors", async () => {
    const { client } = fakeClient(USER, { error: { message: "permission denied" } });
    await expect(new SupabaseSimulationStore(client).list()).rejects.toThrow("permission denied");
  });
});

describe("SupabaseSimulationStore without a session", () => {
  it("refuses every operation with NoSessionError and never touches the table", async () => {
    const { client, ops } = fakeClient(null);
    const store = new SupabaseSimulationStore(client);
    await expect(store.list()).rejects.toBeInstanceOf(NoSessionError);
    await expect(store.save(record("A budgeting app for freelancers"))).rejects.toBeInstanceOf(NoSessionError);
    await expect(store.remove("x")).rejects.toBeInstanceOf(NoSessionError);
    await expect(store.clear()).rejects.toBeInstanceOf(NoSessionError);
    expect(ops).toEqual([]);
  });
});
