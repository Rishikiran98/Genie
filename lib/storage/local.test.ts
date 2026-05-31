import { describe, expect, it } from "vitest";
import { LocalSimulationStore, type MinimalStorage } from "./local";
import { deriveTitle, type NewSavedSimulation } from "./types";
import { recordToInsert, rowToRecord } from "./supabase";
import { heuristicSimulation } from "../simulation/heuristic";

function fakeStorage(): MinimalStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const record = (idea: string): NewSavedSimulation => ({
  title: deriveTitle(idea),
  input: { idea },
  report: heuristicSimulation({ idea }),
  engine: "heuristic",
});

let counter = 0;
const store = (storage: MinimalStorage) =>
  new LocalSimulationStore(storage, () => `id-${++counter}`);

describe("deriveTitle", () => {
  it("keeps short ideas intact and truncates long ones", () => {
    expect(deriveTitle("  A budgeting app  ")).toBe("A budgeting app");
    const long = "x".repeat(100);
    expect(deriveTitle(long).length).toBeLessThanOrEqual(60);
    expect(deriveTitle(long).endsWith("…")).toBe(true);
  });
});

describe("LocalSimulationStore", () => {
  it("saves and assigns id + createdAt", async () => {
    const s = store(fakeStorage());
    const saved = await s.save(record("A meal-prep marketplace for busy parents"));
    expect(saved.id).toBeTruthy();
    expect(saved.createdAt).toBeTruthy();
    expect(saved.title).toContain("meal-prep");
  });

  it("lists newest first", async () => {
    const s = store(fakeStorage());
    const first = await s.save(record("First idea about an app for students"));
    // Force a later timestamp so ordering is unambiguous.
    await new Promise((r) => setTimeout(r, 5));
    const second = await s.save(record("Second idea about a tool for developers"));
    const list = await s.list();
    expect(list.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it("persists across store instances sharing the same storage", async () => {
    const storage = fakeStorage();
    await store(storage).save(record("A newsletter summarizing research papers"));
    const reloaded = await store(storage).list();
    expect(reloaded).toHaveLength(1);
  });

  it("removes by id", async () => {
    const s = store(fakeStorage());
    const a = await s.save(record("Idea A about a fitness coaching app"));
    await s.save(record("Idea B about a recipe sharing site"));
    await s.remove(a.id);
    const list = await s.list();
    expect(list.map((r) => r.id)).not.toContain(a.id);
    expect(list).toHaveLength(1);
  });

  it("clears everything", async () => {
    const s = store(fakeStorage());
    await s.save(record("Something worth deleting later on"));
    await s.clear();
    expect(await s.list()).toEqual([]);
  });

  it("returns an empty list when storage holds a corrupt value", async () => {
    const storage = fakeStorage();
    storage.setItem("genie.savedSimulations.v1", "{not valid json");
    expect(await store(storage).list()).toEqual([]);
  });
});

describe("supabase mappers", () => {
  it("round-trips a record through insert + row mapping", () => {
    const rec = record("An AI tool that drafts cover letters for job seekers");
    const insert = recordToInsert(rec);
    expect(insert.idea).toBe(rec.input.idea);
    expect(insert.practicality_score).toBe(rec.report.scores.practicality);

    const back = rowToRecord({
      id: "row-1",
      title: insert.title,
      idea: insert.idea,
      audience: insert.audience,
      timeline: insert.timeline,
      engine: insert.engine,
      report: insert.report,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(back.input.idea).toBe(rec.input.idea);
    expect(back.input.audience).toBeUndefined();
    expect(back.report).toEqual(rec.report);
    expect(back.engine).toBe("heuristic");
  });
});
