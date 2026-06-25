#!/usr/bin/env node
/**
 * Ingester CLI. Modes:
 *
 *   auscinema-ingest seed [watches.json]   seed the watches table (idempotent)
 *   auscinema-ingest ingest --once         one sweep, then exit (the checkpoint entrypoint)
 *   auscinema-ingest ingest                loop on INGEST_INTERVAL_MS (default hourly), backing off
 *
 * DATABASE_URL is read from the environment. watches.json path: argv[3] -> $INGEST_WATCHES ->
 * ./watches.json.
 */
import { pathToFileURL } from "node:url";
import { createPool } from "./db.js";
import { defaultRegistry } from "./registry.js";
import { runSweep, shouldBackoff } from "./sweep.js";
import { runRefreshTick, purgeDisappearedSessions } from "./refresh.js";
import {
  maybeEmitCacheAgeDeadManAlert,
  createDeadManWebhookPoster,
  type DeadManAlertState,
} from "./deadman.js";
import { loadWatchesFile, seedWatches } from "./seed.js";
import type { Pool } from "./db.js";

const DEFAULT_WATCHES = "watches.json";
const DEFAULT_INTERVAL_MS = 60 * 60_000; // hourly
const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60_000; // tiered refresh tick cadence
const DEFAULT_BUDGET_PER_CHAIN = 30;
const DEFAULT_TOMBSTONE_RETENTION_MS = 7 * 86_400_000; // keep tombstones 7 days, then purge

function refreshBudget(): number {
  return Number(process.env.REFRESH_BUDGET_PER_CHAIN) || DEFAULT_BUDGET_PER_CHAIN;
}

function tombstoneRetentionMs(): number {
  return Number(process.env.REFRESH_TOMBSTONE_RETENTION_MS) || DEFAULT_TOMBSTONE_RETENTION_MS;
}

const DEFAULT_DEAD_MAN_THRESHOLD_MS = 2 * 60 * 60_000; // 2h with no successful ingest = dead-man
const DEFAULT_DEAD_MAN_DEDUPE_MS = 60 * 60_000; // re-alert at most hourly while stale

function deadManThresholdMs(): number {
  return Number(process.env.REFRESH_DEAD_MAN_THRESHOLD_MS) || DEFAULT_DEAD_MAN_THRESHOLD_MS;
}

function deadManDedupeMs(): number {
  return Number(process.env.REFRESH_DEAD_MAN_DEDUPE_MS) || DEFAULT_DEAD_MAN_DEDUPE_MS;
}

/** Australia/Sydney calendar date "YYYY-MM-DD" for a true UTC instant (matches refresh.ts liveness). */
function sydneyDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * P30.3 (C7) dead-man: after a tick, read the global last successful ingest + oldest live fetched_at
 * and fire the cache-age alert if the cache has aged past the threshold. Non-fatal: any failure here
 * is logged and swallowed so the alert path can never crash the refresh loop. `state` is held across
 * ticks by the caller, so the alert is rate-limited by the dedupe window.
 */
async function runDeadManCheck(
  pool: Pool,
  nowInstant: Date,
  state: DeadManAlertState,
  postWebhook: ReturnType<typeof createDeadManWebhookPoster>,
): Promise<void> {
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
      [sydneyDate(nowInstant)],
    );
    const oldestLiveFetchedAt = oldest.rows[0]?.ts ?? null;

    const res = await maybeEmitCacheAgeDeadManAlert({
      nowInstant,
      lastSuccessfulIngestAt,
      oldestLiveFetchedAt,
      thresholdMs: deadManThresholdMs(),
      dedupeWindowMs: deadManDedupeMs(),
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

function logRefresh(row: { id: number; outcome: string; sessions_due: number; sessions_refreshed: number; sessions_new: number; sessions_skipped_budget: number; errors: number }): void {
  log(
    `refresh #${row.id}: ${row.outcome} due=${row.sessions_due} refreshed=${row.sessions_refreshed} ` +
      `new=${row.sessions_new} skipped_budget=${row.sessions_skipped_budget} errors=${row.errors}`,
  );
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveWatchesPath(argv: string[]): string {
  return argv[3] ?? process.env.INGEST_WATCHES ?? DEFAULT_WATCHES;
}

async function doSeed(argv: string[]): Promise<void> {
  const path = resolveWatchesPath(argv);
  const pool = createPool();
  try {
    const seeds = await loadWatchesFile(path);
    const { inserted, skipped } = await seedWatches(pool, seeds);
    log(`seed: ${inserted} inserted, ${skipped} skipped (already present) from ${path}`);
  } finally {
    await pool.end();
  }
}

async function doIngestOnce(): Promise<void> {
  const pool = createPool();
  try {
    const res = await runSweep({ registry: defaultRegistry(), pool });
    log(
      `sweep #${res.runId}: ${res.watches} watch(es), ${res.sessionsUpserted} session(s) upserted, ` +
        `${res.seatmapsFetched} seat map(s), ${res.errors.length} error(s)`,
    );
    for (const e of res.errors) {
      const subj = e.sessionId ? `watch ${e.watchId} session ${e.sessionId}` : `watch ${e.watchId}`;
      log(`  ${subj} error: ${e.error}`);
    }
  } finally {
    await pool.end();
  }
}

async function doIngestLoop(): Promise<never> {
  const baseInterval = Number(process.env.INGEST_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  const maxBackoff = baseInterval * 8;
  let backoff = baseInterval;
  const registry = defaultRegistry();
  const pool = createPool();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await runSweep({ registry, pool });
      log(
        `sweep #${res.runId}: ${res.watches} watch(es), ${res.sessionsUpserted} upserted, ` +
          `${res.seatmapsFetched} seat map(s), ${res.errors.length} error(s)`,
      );
      if (shouldBackoff(res, res.watches)) {
        log(`majority of watches failed; backing off ${Math.round(backoff / 1000)}s`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, maxBackoff);
        continue;
      }
      backoff = baseInterval; // reset on success
    } catch (err) {
      log(`sweep failed: ${(err as Error).message}; backing off ${Math.round(backoff / 1000)}s`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, maxBackoff);
      continue;
    }
    await sleep(baseInterval);
  }
}

async function doRefreshOnce(): Promise<void> {
  const pool = createPool();
  try {
    const row = await runRefreshTick({
      pool,
      registry: defaultRegistry(),
      nowInstant: new Date(),
      budgetPerChain: refreshBudget(),
    });
    logRefresh(row);
  } finally {
    await pool.end();
  }
}

async function doRefreshLoop(): Promise<never> {
  const interval = Number(process.env.REFRESH_TICK_INTERVAL_MS) || DEFAULT_REFRESH_INTERVAL_MS;
  const registry = defaultRegistry();
  const pool = createPool();

  // P30.3 dead-man: dedupe state held in memory across ticks; one poster reused for the loop.
  const deadManState: DeadManAlertState = {};
  const deadManPoster = createDeadManWebhookPoster(process.env.REFRESH_DEAD_MAN_WEBHOOK);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const tickAt = new Date();
      const row = await runRefreshTick({
        pool,
        registry,
        nowInstant: tickAt,
        budgetPerChain: refreshBudget(),
      });
      logRefresh(row);
      // C6 purge: drop tombstones older than the retention window each tick (cheap indexed delete).
      await purgeDisappearedSessions({ pool, nowInstant: tickAt, retentionMs: tombstoneRetentionMs() });
    } catch (err) {
      log(`refresh tick failed: ${(err as Error).message}`);
    } finally {
      // P30.3 dead-man runs EVERY iteration, including when the tick threw (runRefreshTick writes an
      // outcome='error' row and rethrows). A run of hard-failing ticks is exactly when the cache ages
      // with no fresh ok ingest, so the dead-man MUST still fire — it reads the last ok refresh_runs
      // row. Fresh `new Date()` at check time; dedupe state persists across iterations. Internally
      // non-fatal (own try/catch). Cold start (no ok row ever) stays silent: now - null = NaN.
      await runDeadManCheck(pool, new Date(), deadManState, deadManPoster);
    }
    await sleep(interval);
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "seed") {
    await doSeed(process.argv);
    return;
  }
  if (mode === "ingest") {
    if (process.argv.includes("--once")) {
      await doIngestOnce();
    } else {
      await doIngestLoop();
    }
    return;
  }
  if (mode === "refresh") {
    if (process.argv.includes("--once")) {
      await doRefreshOnce();
    } else {
      await doRefreshLoop();
    }
    return;
  }
  console.error("usage: auscinema-ingest <seed [watches.json] | ingest [--once] | refresh [--once]>");
  process.exitCode = 2;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}
