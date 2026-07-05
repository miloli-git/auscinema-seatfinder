/**
 * Refresh-loop iteration wiring (#64). The dead-man check MUST run BEFORE the tick, reading whatever
 * `refresh_runs` state existed at the start of the iteration -- never the row this same iteration's
 * tick is about to write. Before this fix the check ran after the tick, in the loop's `finally`, so a
 * healthy loop always measured its own just-written `ok` row (age ~0) and the alert could only ever
 * fire off a run of *failing* ticks -- the narrowest of the failure modes it's meant to cover (see
 * GH #64). Running the check first decouples the checker from the heartbeat writer: they become
 * independent failure domains, and staleness accumulated by prior failed/skipped ticks is measured
 * honestly even on an iteration whose own tick is about to succeed.
 *
 * This does NOT and cannot cover a dead/hung refresh process (nothing is left running to check) or a
 * DB outage (the check itself needs the DB). Both are explicitly deferred to an external liveness
 * probe (e.g. Healthchecks.io-style missing-ping alert) per the design note on #64.
 */
import type { Pool } from "./db.js";
import type { AdapterRegistry } from "./registry.js";
import { runRefreshTick, purgeDisappearedSessions, type RefreshRunRow } from "./refresh.js";
import {
  maybeEmitCacheAgeDeadManAlert,
  type DeadManAlertState,
  type DeadManPayload,
} from "./deadman.js";

export interface DeadManCheckDeps {
  pool: Pool;
  nowInstant: Date;
  thresholdMs: number;
  dedupeWindowMs: number;
  state: DeadManAlertState;
  postWebhook: (payload: DeadManPayload) => Promise<void>;
  log: (msg: string) => void;
  /** Australia/Sydney calendar date "YYYY-MM-DD" for a true UTC instant. */
  sydneyDateOf: (instant: Date) => string;
}

/**
 * Read the current dead-man signal from the DB and fire the cache-age alert if warranted. Non-fatal:
 * any failure (including the DB being unreachable) is logged and swallowed so this can never crash
 * the refresh loop.
 */
export async function runDeadManCheck(deps: DeadManCheckDeps): Promise<void> {
  const { pool, nowInstant, thresholdMs, dedupeWindowMs, state, postWebhook, log, sydneyDateOf } = deps;
  try {
    const ingest = await pool.query<{ ts: Date | null }>(
      `SELECT COALESCE(finished_at, started_at) AS ts
         FROM refresh_runs
        WHERE outcome = 'ok'
        ORDER BY COALESCE(finished_at, started_at) DESC
        LIMIT 1`,
    );
    const lastSuccessfulIngestAt = ingest.rows[0]?.ts ?? null;

    const oldest = await pool.query<{ ts: Date | null }>(
      `SELECT MIN(fetched_at) AS ts
         FROM sessions
        WHERE disappeared_at IS NULL AND date >= $1`,
      [sydneyDateOf(nowInstant)],
    );
    const oldestLiveFetchedAt = oldest.rows[0]?.ts ?? null;

    const res = await maybeEmitCacheAgeDeadManAlert({
      nowInstant,
      lastSuccessfulIngestAt,
      oldestLiveFetchedAt,
      thresholdMs,
      dedupeWindowMs,
      state,
      postWebhook,
    });
    if (res.alerted) {
      log(`dead-man: cache age ${res.cacheAgeMs}ms over threshold — alert posted`);
    }
  } catch (err) {
    log(`dead-man check failed (non-fatal): ${(err as Error).message}`);
  }
}

export interface RefreshLoopIterationDeps {
  pool: Pool;
  registry: AdapterRegistry;
  budgetPerChain: number;
  tombstoneRetentionMs: number;
  deadMan: {
    thresholdMs: number;
    dedupeWindowMs: number;
    state: DeadManAlertState;
    postWebhook: (payload: DeadManPayload) => Promise<void>;
  };
  log: (msg: string) => void;
  logRefresh: (row: RefreshRunRow) => void;
  sydneyDateOf: (instant: Date) => string;
}

/**
 * One refresh-loop iteration (#64 fix). Order is load-bearing: the dead-man check runs FIRST, against
 * pre-tick state, then the tick runs and (on success) writes its own fresh `ok` row for the NEXT
 * iteration's check to read.
 */
export async function runRefreshLoopIteration(deps: RefreshLoopIterationDeps): Promise<void> {
  const { pool, registry, budgetPerChain, tombstoneRetentionMs, deadMan, log, logRefresh, sydneyDateOf } =
    deps;

  await runDeadManCheck({
    pool,
    nowInstant: new Date(),
    thresholdMs: deadMan.thresholdMs,
    dedupeWindowMs: deadMan.dedupeWindowMs,
    state: deadMan.state,
    postWebhook: deadMan.postWebhook,
    log,
    sydneyDateOf,
  });

  try {
    const tickAt = new Date();
    const row = await runRefreshTick({ pool, registry, nowInstant: tickAt, budgetPerChain });
    logRefresh(row);
    // C6 purge: drop tombstones older than the retention window each tick (cheap indexed delete).
    await purgeDisappearedSessions({ pool, nowInstant: tickAt, retentionMs: tombstoneRetentionMs });
  } catch (err) {
    log(`refresh tick failed: ${(err as Error).message}`);
  }
}
