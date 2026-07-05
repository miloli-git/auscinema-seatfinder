import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createPool,
  runRefreshLoopIteration,
  type AdapterRegistry,
  type DeadManAlertState,
  type DeadManPayload,
} from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const hasDatabase = Boolean(databaseUrl);
const dbSkip = hasDatabase ? false : "DATABASE_URL is unset";
let pool: ReturnType<typeof createPool> | undefined;

function requirePool(): ReturnType<typeof createPool> {
  assert.ok(pool, "test database pool should be initialised");
  return pool;
}

function assertDisposableDatabase(url: string): void {
  const parsed = new URL(url);
  assert.notEqual(
    parsed.pathname.replace(/^\//, ""),
    "seatfinder",
    "refusing to run destructive refresh-loop tests against the live seatfinder database",
  );
}

before(async () => {
  if (!databaseUrl) return;
  assertDisposableDatabase(databaseUrl);
  pool = createPool(databaseUrl);
  const schema = await readFile(new URL("../../../db/schema.sql", import.meta.url), "utf8");
  await pool.query(schema);
});

beforeEach(async () => {
  if (!pool) return;
  await pool.query("TRUNCATE watches, sessions, session_seats, ingest_runs RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE refresh_runs RESTART IDENTITY CASCADE").catch((err: unknown) => {
    if ((err as { code?: string }).code !== "42P01") throw err;
  });
});

after(async () => {
  await pool?.end();
});

function hours(n: number): number {
  return n * 60 * 60_000;
}

async function insertOkRun(finishedAgo: string): Promise<void> {
  const p = requirePool();
  await p.query(
    `INSERT INTO refresh_runs
       (started_at, finished_at, outcome, sessions_due, sessions_refreshed, sessions_skipped_budget,
        sessions_new, sessions_disappeared, errors, per_chain, per_tier)
     VALUES (now() - $1::interval, now() - $1::interval, 'ok', 0, 0, 0, 0, 0, 0, '{}'::jsonb, '{}'::jsonb)`,
    [finishedAgo],
  );
}

function capturingPoster(calls: DeadManPayload[]): (payload: DeadManPayload) => Promise<void> {
  return async (payload: DeadManPayload): Promise<void> => {
    calls.push(payload);
  };
}

function iterationDeps(overrides: {
  postWebhook: (payload: DeadManPayload) => Promise<void>;
  state?: DeadManAlertState;
}): Parameters<typeof runRefreshLoopIteration>[0] {
  return {
    pool: requirePool(),
    registry: {} as AdapterRegistry, // no watches seeded -> tick succeeds trivially (sessions_due = 0)
    budgetPerChain: 30,
    tombstoneRetentionMs: hours(24 * 7),
    deadMan: {
      thresholdMs: hours(2),
      dedupeWindowMs: hours(1),
      state: overrides.state ?? {},
      postWebhook: overrides.postWebhook,
    },
    log: () => {},
    logRefresh: () => {},
    sydneyDateOf: (d: Date) => d.toISOString().slice(0, 10),
  };
}

test(
  "#64 dead-man fires organically: stale PRE-tick heartbeat alerts even though this iteration's own tick succeeds",
  { skip: dbSkip },
  async () => {
    // Seed a stale successful heartbeat (3h old, past the 2h threshold) BEFORE the iteration runs.
    await insertOkRun("3 hours");

    const calls: DeadManPayload[] = [];
    await runRefreshLoopIteration(iterationDeps({ postWebhook: capturingPoster(calls) }));

    assert.equal(
      calls.length,
      1,
      "dead-man must fire off the pre-existing stale row, not the fresh row this tick is about to write",
    );
    assert.ok(calls[0]!.deadMan.cacheAgeMs >= hours(3) - 5_000);

    // The tick itself still ran and wrote its own fresh 'ok' row (proves the check didn't block/consume it).
    const p = requirePool();
    const latest = (
      await p.query<{ outcome: string }>("SELECT outcome FROM refresh_runs ORDER BY id DESC LIMIT 1")
    ).rows[0];
    assert.equal(latest?.outcome, "ok");
  },
);

test(
  "#64 dead-man does not fire when the heartbeat is fresh",
  { skip: dbSkip },
  async () => {
    // Fresh successful heartbeat (well under the 2h threshold).
    await insertOkRun("1 minute");

    const calls: DeadManPayload[] = [];
    await runRefreshLoopIteration(iterationDeps({ postWebhook: capturingPoster(calls) }));

    assert.deepEqual(calls, []);
  },
);

test(
  "#64 a run of failing ticks still accumulates staleness against the last real success",
  { skip: dbSkip },
  async () => {
    // Last real success is old enough to be stale on its own.
    await insertOkRun("3 hours");
    // A subsequent failed tick's error row must not reset/mask the staleness measurement.
    const p = requirePool();
    await p.query(
      `INSERT INTO refresh_runs
         (started_at, finished_at, outcome, sessions_due, sessions_refreshed, sessions_skipped_budget,
          sessions_new, sessions_disappeared, errors, per_chain, per_tier)
       VALUES (now() - interval '10 minutes', now() - interval '10 minutes', 'error', 0, 0, 0, 0, 0, 1, '{}'::jsonb, '{}'::jsonb)`,
    );

    const calls: DeadManPayload[] = [];
    await runRefreshLoopIteration(iterationDeps({ postWebhook: capturingPoster(calls) }));

    assert.equal(calls.length, 1, "the error row is not outcome='ok', so the stale 'ok' row still governs");
  },
);
