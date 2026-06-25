import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPool } from "@auscinema/ingester";

const databaseUrl = process.env.DATABASE_URL;
const hasDatabase = Boolean(databaseUrl);
const dbSkip = hasDatabase ? false : "DATABASE_URL is unset";
const schemaName = `p303_api_${process.pid}`;
const FUTURE_DATE = "2099-10-05";
const STALE_ENV = "TOGETHER_FRESHNESS_STALE_MS";
const STALE_AFTER_MS = 60_000;

let schemaSql = "";
let adminPool: ReturnType<typeof createPool> | undefined;
let pool: ReturnType<typeof createPool> | undefined;
let previousStaleEnv: string | undefined;

type Pool = ReturnType<typeof createPool>;

type CoverageState = "cached" | "not_cached" | "stale";

type TogetherResponse = {
  party: number;
  minScore: number;
  count: number;
  results: Array<{
    session: {
      id: string;
      chain: string;
      movieId: string;
      cinemaId: string;
      date: string;
      startTime: string | null;
    };
    block: {
      row: number;
      rowLabel: string;
      startCol: number;
      seatIds: string[];
      avgScore: number;
      minScore: number;
    } | null;
    approximateAdjacency: boolean;
    fetchedAt: string;
  }>;
  freshness: {
    oldestFetchedAt: string | null;
    newestFetchedAt: string | null;
    lastSuccessfulIngestAt: string | null;
    coverage: Record<string, CoverageState>;
  };
};

function requirePool(): Pool {
  assert.ok(pool, "test database pool should be initialised");
  return pool;
}

function requireAdminPool(): Pool {
  assert.ok(adminPool, "test database admin pool should be initialised");
  return adminPool;
}

function assertDisposableDatabase(url: string): void {
  const parsed = new URL(url);
  assert.notEqual(
    parsed.pathname.replace(/^\//, ""),
    "seatfinder",
    "refusing to run destructive P30.3 API tests against the live seatfinder database",
  );
}

function scopedDatabaseUrl(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("options", `-c search_path=${schema}`);
  return parsed.toString();
}

async function resetScopedSchema(): Promise<void> {
  await requireAdminPool().query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await requireAdminPool().query(`CREATE SCHEMA ${schemaName}`);
}

before(async () => {
  schemaSql = await readFile(new URL("../../../db/schema.sql", import.meta.url), "utf8");
  previousStaleEnv = process.env[STALE_ENV];
  process.env[STALE_ENV] = String(STALE_AFTER_MS);
  if (!databaseUrl) return;
  assertDisposableDatabase(databaseUrl);
  adminPool = createPool(databaseUrl);
  pool = createPool(scopedDatabaseUrl(databaseUrl, schemaName));
  await resetScopedSchema();
});

beforeEach(async () => {
  if (!pool) return;
  await resetScopedSchema();
  await pool.query(schemaSql);
});

after(async () => {
  if (previousStaleEnv === undefined) delete process.env[STALE_ENV];
  else process.env[STALE_ENV] = previousStaleEnv;
  await pool?.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => undefined);
    await adminPool.end();
  }
});

function beforeNow(ageMs: number): Date {
  return new Date(Date.now() - ageMs);
}

async function insertWatch(args: { chain?: string; enabled?: boolean } = {}): Promise<number> {
  const { rows } = await requirePool().query<{ id: string | number }>(
    `INSERT INTO watches (chain, cinema_ids, date_from, date_to, movie_id, party, min_score, scoring, enabled)
     VALUES ($1, ARRAY['C1']::text[], $2, $2, NULL, 2, 74, NULL, $3)
     RETURNING id`,
    [args.chain ?? "event", FUTURE_DATE, args.enabled ?? true],
  );
  return Number(rows[0]!.id);
}

async function insertRefreshRun(args: {
  outcome: "ok" | "lock_skipped" | "error";
  startedAt: Date;
  finishedAt?: Date | null;
}): Promise<void> {
  await requirePool().query(
    `INSERT INTO refresh_runs (started_at, finished_at, outcome)
     VALUES ($1, $2, $3)`,
    [args.startedAt, args.finishedAt ?? null, args.outcome],
  );
}

async function insertSession(args: {
  id: string;
  fetchedAt: Date;
  watchId?: number | null;
  chain?: string;
  movieId?: string;
  cinemaId?: string;
  date?: string;
  startTime?: string;
  disappearedAt?: Date | null;
}): Promise<void> {
  const chain = args.chain ?? "event";
  const movieId = args.movieId ?? "M1";
  const cinemaId = args.cinemaId ?? "C1";
  const date = args.date ?? FUTURE_DATE;
  await requirePool().query(
    `INSERT INTO sessions
       (id, watch_id, chain, movie_id, movie_name, cinema_id, cinema_name, date, start_time,
        format, screen, seats_available, booking_url, seat_allocation, fetched_at, last_seen,
        disappeared_at)
     VALUES
       ($1, $2, $3, $4, 'Test Movie', $5, $6, $7, $8,
        'V-Max', '3', 42, $9, true, $10, $10, $11)`,
    [
      args.id,
      args.watchId ?? null,
      chain,
      movieId,
      cinemaId,
      `Cinema ${cinemaId}`,
      date,
      args.startTime ?? `${date}T19:00:00.000Z`,
      `https://example.test/book?sid=${args.id}`,
      args.fetchedAt,
      args.disappearedAt ?? null,
    ],
  );
}

async function insertSeats(sessionId: string): Promise<void> {
  await requirePool().query(
    `INSERT INTO session_seats (session_id, seat_id, row_label, row, col, area_kind, score)
     VALUES
       ($1, $2, 'A', 1, 1, 'standard', 90),
       ($1, $3, 'A', 1, 2, 'standard', 92)`,
    [sessionId, `${sessionId}-A1`, `${sessionId}-A2`],
  );
}

async function getTogether(query: string): Promise<TogetherResponse> {
  const { buildServer } = await import("./index.js");
  const server = buildServer({ pool: requirePool(), rateLimit: false, logger: false });
  try {
    const res = await server.inject({ method: "GET", url: `/together?${query}` });
    assert.equal(res.statusCode, 200);
    return res.json() as TogetherResponse;
  } finally {
    await server.close();
  }
}

function resultIds(body: TogetherResponse): string[] {
  return body.results.map((r) => r.session.id);
}

function assertAdditiveTogetherShape(body: TogetherResponse): void {
  assert.deepEqual(Object.keys(body).sort(), ["count", "freshness", "minScore", "party", "results"]);
  assert.deepEqual(Object.keys(body.freshness).sort(), [
    "coverage",
    "lastSuccessfulIngestAt",
    "newestFetchedAt",
    "oldestFetchedAt",
  ]);
  for (const result of body.results) {
    assert.deepEqual(Object.keys(result).sort(), ["approximateAdjacency", "block", "fetchedAt", "session"]);
  }
}

test(
  "C7 /together adds freshness from the same live result set without changing count/results",
  { skip: dbSkip },
  async () => {
    const watchId = await insertWatch({ chain: "event" });
    const olderFetchedAt = beforeNow(20_000);
    const newerFetchedAt = beforeNow(5_000);
    const fallbackOkStartedAt = beforeNow(2_000);

    await insertRefreshRun({
      outcome: "ok",
      startedAt: beforeNow(30_000),
      finishedAt: beforeNow(25_000),
    });
    await insertRefreshRun({
      outcome: "ok",
      startedAt: fallbackOkStartedAt,
      finishedAt: null,
    });
    await insertRefreshRun({
      outcome: "error",
      startedAt: beforeNow(1_000),
      finishedAt: beforeNow(500),
    });

    await insertSession({
      id: "live-newer",
      watchId,
      fetchedAt: newerFetchedAt,
      startTime: `${FUTURE_DATE}T18:00:00.000Z`,
    });
    await insertSession({
      id: "live-older",
      watchId,
      fetchedAt: olderFetchedAt,
      startTime: `${FUTURE_DATE}T19:00:00.000Z`,
    });
    await insertSession({
      id: "tombstoned-older",
      watchId,
      fetchedAt: beforeNow(10 * 60_000),
      disappearedAt: beforeNow(60_000),
    });
    await insertSession({
      id: "past-older",
      watchId,
      fetchedAt: beforeNow(20 * 60_000),
      date: "2000-01-01",
      startTime: "2000-01-01T19:00:00.000Z",
    });
    for (const id of ["live-newer", "live-older", "tombstoned-older", "past-older"]) {
      await insertSeats(id);
    }

    const body = await getTogether(`chain=event&dateFrom=2000-01-01&dateTo=${FUTURE_DATE}&party=2&minScore=74`);

    assertAdditiveTogetherShape(body);
    assert.equal(body.party, 2);
    assert.equal(body.minScore, 74);
    assert.equal(body.count, 2);
    assert.equal(body.results.length, body.count);
    assert.deepEqual(resultIds(body), ["live-newer", "live-older"]);
    assert.deepEqual(
      body.results.map((r) => r.fetchedAt),
      [newerFetchedAt.toISOString(), olderFetchedAt.toISOString()],
      "result fetchedAt values are unchanged by the top-level freshness object",
    );
    assert.deepEqual(body.freshness, {
      oldestFetchedAt: olderFetchedAt.toISOString(),
      newestFetchedAt: newerFetchedAt.toISOString(),
      lastSuccessfulIngestAt: fallbackOkStartedAt.toISOString(),
      coverage: { event: "cached" },
    });
  },
);

test("C7 empty not-ingested chain reports not_cached with null freshness instants", { skip: dbSkip }, async () => {
  const body = await getTogether(`chain=hoyts&dateFrom=${FUTURE_DATE}&dateTo=${FUTURE_DATE}`);

  assertAdditiveTogetherShape(body);
  assert.equal(body.count, 0);
  assert.deepEqual(body.results, []);
  assert.deepEqual(body.freshness, {
    oldestFetchedAt: null,
    newestFetchedAt: null,
    lastSuccessfulIngestAt: null,
    coverage: { hoyts: "not_cached" },
  });
});

test("C7 coverage marks a cached chain stale when oldest live fetched_at exceeds the threshold", { skip: dbSkip }, async () => {
  const watchId = await insertWatch({ chain: "event" });
  const staleFetchedAt = beforeNow(STALE_AFTER_MS + 30_000);
  const lastOk = beforeNow(10_000);
  await insertRefreshRun({ outcome: "ok", startedAt: beforeNow(20_000), finishedAt: lastOk });
  await insertSession({ id: "stale-live", watchId, fetchedAt: staleFetchedAt });
  await insertSeats("stale-live");

  const body = await getTogether(`chain=event&dateFrom=${FUTURE_DATE}&dateTo=${FUTURE_DATE}`);

  assertAdditiveTogetherShape(body);
  assert.equal(body.count, 1);
  assert.deepEqual(body.freshness, {
    oldestFetchedAt: staleFetchedAt.toISOString(),
    newestFetchedAt: staleFetchedAt.toISOString(),
    lastSuccessfulIngestAt: lastOk.toISOString(),
    coverage: { event: "stale" },
  });
});

test(
  "C7 empty query on an ingested chain stays distinct from not_cached",
  { skip: dbSkip },
  async () => {
    const watchId = await insertWatch({ chain: "event" });
    const lastOk = beforeNow(20_000);
    await insertRefreshRun({ outcome: "ok", startedAt: beforeNow(30_000), finishedAt: lastOk });
    await insertSession({
      id: "other-movie-live",
      watchId,
      movieId: "M1",
      fetchedAt: beforeNow(5_000),
    });
    await insertSeats("other-movie-live");

    const body = await getTogether(`chain=event&movieId=M2&dateFrom=${FUTURE_DATE}&dateTo=${FUTURE_DATE}`);

    assertAdditiveTogetherShape(body);
    assert.equal(body.count, 0);
    assert.deepEqual(body.results, []);
    assert.deepEqual(body.freshness, {
      oldestFetchedAt: null,
      newestFetchedAt: null,
      lastSuccessfulIngestAt: lastOk.toISOString(),
      coverage: { event: "cached" },
    });
  },
);
