/**
 * Persisted de-dupe state: the set of (watchId, sessionId, seatId) hits already alerted,
 * so an open seat doesn't re-alert on every poll. Stored as a flat JSON key list.
 */
import { readFile, writeFile, rename } from "node:fs/promises";

const SEP = ""; // unit separator — never appears in ids

export class WatchState {
  private readonly keys: Set<string>;

  constructor(initial: Iterable<string> = []) {
    this.keys = new Set(initial);
  }

  static keyOf(watchId: string, sessionId: string, seatId: string): string {
    return `${watchId}${SEP}${sessionId}${SEP}${seatId}`;
  }

  /** The (watchId, sessionId) prefix used to scope pruning to checked sessions. */
  static sessionPrefixOf(watchId: string, sessionId: string): string {
    return `${watchId}${SEP}${sessionId}${SEP}`;
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }

  add(key: string): void {
    this.keys.add(key);
  }

  delete(key: string): void {
    this.keys.delete(key);
  }

  /**
   * Drop alerted keys whose session was checked this run but that are no longer hits,
   * so a seat that reopens later can alert again.
   */
  pruneStale(checkedSessionPrefixes: ReadonlySet<string>, currentHitKeys: ReadonlySet<string>): void {
    for (const key of [...this.keys]) {
      if (currentHitKeys.has(key)) continue;
      const idx = key.lastIndexOf(SEP);
      const prefix = idx >= 0 ? key.slice(0, idx + 1) : key;
      if (checkedSessionPrefixes.has(prefix)) this.keys.delete(key);
    }
  }

  toArray(): string[] {
    return [...this.keys];
  }
}

/** Load state from disk; a missing file yields empty state. */
export async function loadState(path: string): Promise<WatchState> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return new WatchState();
  }
  try {
    const parsed = JSON.parse(text) as { alerted?: unknown };
    const list = Array.isArray(parsed.alerted) ? parsed.alerted.filter((k): k is string => typeof k === "string") : [];
    return new WatchState(list);
  } catch {
    return new WatchState();
  }
}

/** Persist state atomically (temp file + rename). */
export async function saveState(path: string, state: WatchState): Promise<void> {
  const body = JSON.stringify({ version: 1, alerted: state.toArray() }, null, 2);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
}
