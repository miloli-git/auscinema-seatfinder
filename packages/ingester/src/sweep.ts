/**
 * The sweep: per enabled watch, list sessions across the watch's cinemas x date-range, fetch +
 * score each seat map, and upsert the session + its AVAILABLE scored seats. Mirrors the watcher's
 * per-session isolation, concurrency limit and backoff classifier (packages/watcher/src/check.ts).
 */
import { scoreAvailableSeats, type SeatMap, type SeatPreference, type Session } from "@auscinema/core";
import type { Pool } from "./db.js";
import type { AdapterRegistry } from "./registry.js";
import { resolveAdapter } from "./registry.js";
import { finishIngestRun, startIngestRun, upsertSessionWithSeats } from "./persist.js";
import { datesInRange, loadEnabledWatches, watchToQuery } from "./watches.js";
import type { SeatUpsert, SessionUpsert, SweepError, SweepResult, WatchRow } from "./types.js";

export interface SweepDeps {
  pool: Pool;
  registry: AdapterRegistry;
  /** Max concurrent seat-map fetches per watch. Default 4. */
  concurrency?: number;
  /** Cap on seat maps fetched per watch, to keep the live sweep bounded + polite. Default 60. */
  maxSeatmapsPerWatch?: number;
}

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_SEATMAPS = 60;

/** Resolve a seat's normalised area kind via the map's area list. */
export function areaKindOf(map: SeatMap, areaId: string): string | undefined {
  return map.areas.find((a) => a.id === areaId)?.kind;
}

/**
 * AVAILABLE + scored seats of a map as session_seats rows. scoreAvailableSeats already filters to
 * status === "available"; we keep ALL available seats (any score) so party N / minScore stay tunable
 * at query time (design §Cache depth). Sold/spacer seats are absent => a column gap = adjacency break.
 */
export function toSeatUpserts(map: SeatMap, pref?: SeatPreference): SeatUpsert[] {
  return scoreAvailableSeats(map, pref).map(({ seat, score }) => ({
    seatId: seat.id,
    ...(seat.rowLabel !== undefined ? { rowLabel: seat.rowLabel } : {}),
    row: seat.row,
    col: seat.col,
    ...(areaKindOf(map, seat.areaId) !== undefined ? { areaKind: areaKindOf(map, seat.areaId)! } : {}),
    score,
  }));
}

/** Map a normalised Session to a sessions-table upsert. */
export function sessionToUpsert(session: Session, watchId: number): SessionUpsert {
  return {
    id: session.id,
    watchId,
    chain: session.chain,
    movieId: session.movieId,
    ...(session.movieName !== undefined ? { movieName: session.movieName } : {}),
    cinemaId: session.cinemaId,
    ...(session.cinemaName !== undefined ? { cinemaName: session.cinemaName } : {}),
    // `date` is derived from the local date prefix in app code (NOT from the timestamptz column),
    // so session date-filing is TZ-safe regardless of how Postgres interprets start_time. Note:
    // start_time is stored in a TIMESTAMPTZ column; offset-less chains (Event/Hoyts) are read in
    // the DB session timezone, so start_time wall-time is approximate for display only. v1 confirms
    // the live seat map on open, so this cache value is not authoritative.
    date: session.startTime.slice(0, 10),
    startTime: session.startTime,
    format: session.format.raw || session.format.kind,
    ...(session.screenName !== undefined ? { screen: session.screenName } : {}),
    ...(session.seatsAvailable !== undefined ? { seatsAvailable: session.seatsAvailable } : {}),
    bookingUrl: session.bookingUrl,
    seatAllocation: session.seatAllocation,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Bounded-concurrency map (copied from watcher/check.ts — same polite-fetch pattern). */
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

interface SweepCounters {
  sessionsUpserted: number;
  seatmapsFetched: number;
  errors: SweepError[];
}

/** Gather candidate sessions for a watch across its date range (per-date isolation). */
async function listWatchSessions(
  watch: WatchRow,
  registry: AdapterRegistry,
  counters: SweepCounters,
): Promise<Session[]> {
  const adapter = resolveAdapter(registry, watch.chain);
  const byId = new Map<string, Session>();
  for (const date of datesInRange(watch.dateFrom, watch.dateTo)) {
    try {
      const sessions = await adapter.listSessions(watchToQuery(watch, date));
      for (const s of sessions) {
        // Defensive: a leaky adapter could return sessions outside the requested date; only
        // ingest sessions whose local date matches (mirrors the watcher's candidate filter).
        if (!s.startTime.startsWith(date)) continue;
        if (!s.seatAllocation) continue; // no seat map to score
        if (!byId.has(s.id)) byId.set(s.id, s);
      }
    } catch (err) {
      counters.errors.push({ watchId: watch.id, error: `listSessions ${date}: ${errorMessage(err)}` });
    }
  }
  return [...byId.values()];
}

/** Sweep one watch: fetch + score + upsert each candidate session, isolated per session. */
async function sweepWatch(watch: WatchRow, deps: SweepDeps, counters: SweepCounters): Promise<void> {
  const adapter = resolveAdapter(deps.registry, watch.chain); // throws here => watch-level error
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
  const cap = deps.maxSeatmapsPerWatch ?? DEFAULT_MAX_SEATMAPS;
  const pref = watch.scoring ?? undefined;

  // v1 limitation (frozen schema): session_seats is keyed (session_id, seat_id) with no watch
  // dimension, so the stored score is canonical per session. If two enabled watches overlap the
  // SAME session id with DIFFERENT `scoring` prefs, the later-processed watch (higher id —
  // loadEnabledWatches orders by id) deterministically wins. Divergent per-watch scoring over a
  // shared session is out of scope until the schema gains a watch/scoring dimension. The seed
  // watch (and v1 in general) uses a single scoring pref, so this does not bite in practice.
  const all = await listWatchSessions(watch, deps.registry, counters);
  const candidates = all.slice(0, Math.max(0, cap));

  await mapWithConcurrency(candidates, concurrency, async (session) => {
    try {
      const map = await adapter.getSeatMap(session.id, { preview: true });
      counters.seatmapsFetched++;
      const seats = toSeatUpserts(map, pref);
      await upsertSessionWithSeats(deps.pool, sessionToUpsert(session, watch.id), seats);
      counters.sessionsUpserted++;
    } catch (err) {
      counters.errors.push({ watchId: watch.id, sessionId: session.id, error: errorMessage(err) });
    }
  });
}

/**
 * Run one full sweep. Writes exactly one ingest_runs row (open on entry, closed with counts on
 * finish). A watch-level failure is isolated and does not abort the other watches.
 */
export async function runSweep(deps: SweepDeps): Promise<SweepResult> {
  const runId = await startIngestRun(deps.pool);
  const counters: SweepCounters = { sessionsUpserted: 0, seatmapsFetched: 0, errors: [] };

  let watches: WatchRow[] = [];
  try {
    watches = await loadEnabledWatches(deps.pool);
    for (const watch of watches) {
      try {
        await sweepWatch(watch, deps, counters);
      } catch (err) {
        counters.errors.push({ watchId: watch.id, error: errorMessage(err) });
      }
    }
  } catch (err) {
    // A global pre-watch failure (e.g. loadEnabledWatches) must be counted so the ingest_runs
    // row is not closed looking clean (errors: 0). watchId 0 = no specific watch.
    counters.errors.push({ watchId: 0, error: errorMessage(err) });
    throw err;
  } finally {
    await finishIngestRun(deps.pool, runId, {
      watches: watches.length,
      sessionsUpserted: counters.sessionsUpserted,
      seatmapsFetched: counters.seatmapsFetched,
      errors: counters.errors.length,
    });
  }

  return {
    runId,
    watches: watches.length,
    sessionsUpserted: counters.sessionsUpserted,
    seatmapsFetched: counters.seatmapsFetched,
    errors: counters.errors,
  };
}

/** Distinct failed watches; true when all or a strict majority failed (mirrors the watcher). */
export function shouldBackoff(result: { errors: SweepError[] }, totalWatches: number): boolean {
  if (totalWatches <= 0) return false;
  const failed = new Set(result.errors.map((e) => e.watchId)).size;
  return failed === totalWatches || failed > totalWatches / 2;
}
