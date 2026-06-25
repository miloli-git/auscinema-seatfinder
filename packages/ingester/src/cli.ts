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
import { runRefreshTick } from "./refresh.js";
import { loadWatchesFile, seedWatches } from "./seed.js";

const DEFAULT_WATCHES = "watches.json";
const DEFAULT_INTERVAL_MS = 60 * 60_000; // hourly
const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60_000; // tiered refresh tick cadence
const DEFAULT_BUDGET_PER_CHAIN = 30;

function refreshBudget(): number {
  return Number(process.env.REFRESH_BUDGET_PER_CHAIN) || DEFAULT_BUDGET_PER_CHAIN;
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

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const row = await runRefreshTick({
        pool,
        registry,
        nowInstant: new Date(),
        budgetPerChain: refreshBudget(),
      });
      logRefresh(row);
    } catch (err) {
      log(`refresh tick failed: ${(err as Error).message}`);
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
