import type { NewSavedSimulation, SavedSimulation, SimulationStore } from "./types";

const KEY = "genie.savedSimulations.v1";

/** The slice of the Storage API we actually use — keeps the store testable. */
export type MinimalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Browser-backed store. Durable across reloads, scoped to the device/browser,
 * and requires zero configuration — the default Genie persistence backend.
 */
export class LocalSimulationStore implements SimulationStore {
  constructor(
    private readonly storage: MinimalStorage,
    private readonly genId: () => string = () => crypto.randomUUID(),
  ) {}

  private read(): SavedSimulation[] {
    const raw = this.storage.getItem(KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as SavedSimulation[]) : [];
    } catch {
      // Corrupt payload — don't blow up the app over a bad localStorage value.
      return [];
    }
  }

  private write(items: SavedSimulation[]): void {
    this.storage.setItem(KEY, JSON.stringify(items));
  }

  async list(): Promise<SavedSimulation[]> {
    return this.read().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async save(record: NewSavedSimulation): Promise<SavedSimulation> {
    const saved: SavedSimulation = {
      ...record,
      id: this.genId(),
      createdAt: new Date().toISOString(),
    };
    this.write([saved, ...this.read()]);
    return saved;
  }

  async remove(id: string): Promise<void> {
    this.write(this.read().filter((r) => r.id !== id));
  }

  async clear(): Promise<void> {
    this.storage.removeItem(KEY);
  }
}
