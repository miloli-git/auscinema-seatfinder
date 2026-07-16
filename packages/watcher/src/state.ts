/**
 * Persisted de-dupe state for seat hits and session discovery. Session watches keep both
 * seen session ids and per-date baseline markers so a newly-entered rolling date is silent.
 */
import { readFile, writeFile, rename } from "node:fs/promises";

const SEP = ""; // unit separator - never appears in ids

export class WatchState {
  private readonly keys: Set<string>;
  private readonly seenSessions: Set<string>;
  private readonly sessionBaselines: Set<string>;

  constructor(
    initial: Iterable<string> = [],
    seenSessions: Iterable<string> = [],
    sessionBaselines: Iterable<string> = [],
  ) {
    this.keys = new Set(initial);
    this.seenSessions = new Set(seenSessions);
    this.sessionBaselines = new Set(sessionBaselines);
  }

  static keyOf(watchId: string, sessionId: string, seatId: string): string {
    return `${watchId}${SEP}${sessionId}${SEP}${seatId}`;
  }

  /** The (watchId, sessionId) prefix used to scope pruning to checked sessions. */
  static sessionPrefixOf(watchId: string, sessionId: string): string {
    return `${watchId}${SEP}${sessionId}${SEP}`;
  }

  private static seenSessionKeyOf(watchId: string, sessionId: string): string {
    return `${watchId}${SEP}${sessionId}`;
  }

  private static sessionBaselineKeyOf(watchId: string, date: string): string {
    return `${watchId}${SEP}${date}`;
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

  hasSeenSession(watchId: string, sessionId: string): boolean {
    return this.seenSessions.has(WatchState.seenSessionKeyOf(watchId, sessionId));
  }

  markSessionSeen(watchId: string, sessionId: string): void {
    this.seenSessions.add(WatchState.seenSessionKeyOf(watchId, sessionId));
  }

  hasSessionBaseline(watchId: string, date: string): boolean {
    return this.sessionBaselines.has(WatchState.sessionBaselineKeyOf(watchId, date));
  }

  markSessionBaseline(watchId: string, date: string): void {
    this.sessionBaselines.add(WatchState.sessionBaselineKeyOf(watchId, date));
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

  seenSessionsArray(): string[] {
    return [...this.seenSessions];
  }

  sessionBaselinesArray(): string[] {
    return [...this.sessionBaselines];
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
    const parsed = JSON.parse(text) as { alerted?: unknown; seenSessions?: unknown; sessionBaselines?: unknown };
    const list = Array.isArray(parsed.alerted) ? parsed.alerted.filter((k): k is string => typeof k === "string") : [];
    const seenSessions = Array.isArray(parsed.seenSessions)
      ? parsed.seenSessions.filter((k): k is string => typeof k === "string")
      : [];
    const sessionBaselines = Array.isArray(parsed.sessionBaselines)
      ? parsed.sessionBaselines.filter((k): k is string => typeof k === "string")
      : [];
    return new WatchState(list, seenSessions, sessionBaselines);
  } catch {
    return new WatchState();
  }
}

/** Persist state atomically (temp file + rename). */
export async function saveState(path: string, state: WatchState): Promise<void> {
  const body = JSON.stringify(
    {
      version: 2,
      alerted: state.toArray(),
      seenSessions: state.seenSessionsArray(),
      sessionBaselines: state.sessionBaselinesArray(),
    },
    null,
    2,
  );
  const tmp = `${path}.tmp`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
}
