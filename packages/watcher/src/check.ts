/**
 * The core check: for each watch, list sessions, filter, fetch seat maps politely,
 * rank seats, collect above-threshold available seats, de-dupe against prior alerts,
 * and notify only the new ones.
 */
import { rankSeats, type Session } from "@auscinema/core";
import type { Watch, WatcherConfig, TimeWindow } from "./config.js";
import type { AdapterRegistry } from "./registry.js";
import { resolveAdapter } from "./registry.js";
import { WatchState } from "./state.js";
import type { Hit, Notifier } from "./notifier.js";

export interface CheckDeps {
  registry: AdapterRegistry;
  notifier: Notifier;
  state: WatchState;
  /** Max concurrent seat-map fetches. Default from config / 4. */
  concurrency?: number;
}

export interface CheckResult {
  /** Every above-threshold available seat found this run (incl. already-alerted). */
  hits: Hit[];
  /** The subset that was not previously alerted — what the notifier was sent. */
  newHits: Hit[];
  /** Per-watch errors; a failing watch doesn't abort the others. */
  errors: { watchId: string; error: string }[];
}

/** Extract zero-padded "HH:MM" from an ISO-local start time, if present. */
function timeOf(startTime: string): string | undefined {
  const t = startTime.indexOf("T");
  if (t < 0) return undefined;
  return startTime.slice(t + 1, t + 6);
}

/** Inclusive time-window test. Missing window or unparseable time => included. */
export function inTimeWindow(startTime: string, window?: TimeWindow): boolean {
  if (!window) return true;
  const hm = timeOf(startTime);
  if (hm === undefined) return true;
  return hm >= window.from && hm <= window.to;
}

/** Candidate sessions: right date, in window, and seat-allocated (scorable). */
function candidateSessions(sessions: readonly Session[], watch: Watch): Session[] {
  return sessions.filter(
    (s) => s.seatAllocation && s.startTime.startsWith(watch.date) && inTimeWindow(s.startTime, watch.timeWindow),
  );
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const run = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i] as T, i);
    }
  };
  const pool = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run);
  await Promise.all(pool);
  return results;
}

interface WatchOutcome {
  hits: Hit[];
  /** sessionPrefix for every session whose seat map was successfully fetched this run. */
  checkedSessionPrefixes: string[];
}

/** Run one watch, returning its hits + the sessions it actually checked (no state mutation). */
async function checkWatch(watch: Watch, deps: CheckDeps, concurrency: number): Promise<WatchOutcome> {
  const adapter = resolveAdapter(deps.registry, watch.chain);
  const label = watch.label ?? watch.id;

  const sessions = await adapter.listSessions({
    movieId: watch.movieId,
    cinemaIds: watch.cinemaIds,
    date: watch.date,
  });
  const candidates = candidateSessions(sessions, watch);

  const perSession = await mapWithConcurrency(candidates, concurrency, async (session) => {
    // Polite: use the cached preview availability feed for polling.
    const map = await adapter.getSeatMap(session.id, { preview: true });
    const ranked = rankSeats(map, watch.preference);
    const hits: Hit[] = [];
    for (const { seat, score } of ranked) {
      if (score < watch.minScore) continue; // rankSeats is best-first → rest are lower
      hits.push({
        watchId: watch.id,
        label,
        chain: watch.chain,
        sessionId: session.id,
        seatId: seat.id,
        ...(seat.name ? { seatName: seat.name } : {}),
        score,
        startTime: session.startTime,
        format: session.format.raw || session.format.kind,
        bookingUrl: session.bookingUrl,
      });
    }
    return { hits, prefix: WatchState.sessionPrefixOf(watch.id, session.id) };
  });

  return {
    hits: perSession.flatMap((p) => p.hits),
    checkedSessionPrefixes: perSession.map((p) => p.prefix),
  };
}

/**
 * Run all watches once. Mutates `deps.state` with the new alerts (caller persists it),
 * prunes stale entries for re-checked sessions, and notifies only the new hits.
 */
export async function runCheck(config: WatcherConfig, deps: CheckDeps): Promise<CheckResult> {
  const concurrency = deps.concurrency ?? config.concurrency ?? 4;
  const allHits: Hit[] = [];
  const checkedSessionPrefixes = new Set<string>();
  const errors: CheckResult["errors"] = [];

  for (const watch of config.watches) {
    try {
      const outcome = await checkWatch(watch, deps, concurrency);
      allHits.push(...outcome.hits);
      // Record every (watch, session) actually checked — including sold-out ones with no
      // hits — so stale alerts for them can be pruned.
      for (const prefix of outcome.checkedSessionPrefixes) checkedSessionPrefixes.add(prefix);
    } catch (err) {
      errors.push({ watchId: watch.id, error: (err as Error).message });
    }
  }

  const currentHitKeys = new Set(allHits.map((h) => WatchState.keyOf(h.watchId, h.sessionId, h.seatId)));

  // Optional self-heal: a seat we alerted that is no longer a hit (and whose session we
  // re-checked) is cleared, so it can re-alert if it reopens.
  deps.state.pruneStale(checkedSessionPrefixes, currentHitKeys);

  const newHits = allHits.filter((h) => !deps.state.has(WatchState.keyOf(h.watchId, h.sessionId, h.seatId)));
  for (const h of newHits) {
    deps.state.add(WatchState.keyOf(h.watchId, h.sessionId, h.seatId));
  }

  if (newHits.length > 0) {
    await deps.notifier.notify(newHits);
  }

  return { hits: allHits, newHits, errors };
}
