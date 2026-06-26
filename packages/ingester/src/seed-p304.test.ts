import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPool, seedWatches, type WatchSeed } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const dbSkip = databaseUrl ? false : "DATABASE_URL is unset";
const schemaName = `p304_ingester_${process.pid}`;

let schemaSql = "";
let adminPool: ReturnType<typeof createPool> | undefined;
let pool: ReturnType<typeof createPool> | undefined;

type Pool = ReturnType<typeof createPool>;

type WatchSummary = {
  id: number;
  chain: string;
  cinema_ids: string[];
  movie_id: string | null;
  enabled: boolean;
  session_count: number;
  seat_count: number;
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
    "refusing to run destructive P30.4 seed tests against the live seatfinder database",
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

async function resetToCurrentSchema(): Promise<void> {
  await resetScopedSchema();
  await requirePool().query(schemaSql);
}

before(async () => {
  schemaSql = await readFile(new URL("../../../db/schema.sql", import.meta.url), "utf8");
  if (!databaseUrl) return;
  assertDisposableDatabase(databaseUrl);
  adminPool = createPool(databaseUrl);
  pool = createPool(scopedDatabaseUrl(databaseUrl, schemaName));
});

after(async () => {
  await pool?.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => undefined);
    await adminPool.end();
  }
});

function watchSeed(overrides: Partial<WatchSeed> = {}): WatchSeed {
  return {
    chain: "event",
    cinemaIds: ["15"],
    dateFrom: "2026-07-02",
    dateTo: "2026-07-16",
    movieId: "M1",
    party: 2,
    minScore: 74,
    scoring: null,
    ...overrides,
  };
}

async function insertWatch(overrides: Partial<WatchSeed> = {}): Promise<number> {
  const w = watchSeed(overrides);
  const { rows } = await requirePool().query<{ id: number }>(
    `INSERT INTO watches (chain, cinema_ids, date_from, date_to, movie_id, party, min_score, scoring, enabled)
     VALUES ($1, $2::text[], $3, $4, $5, $6, $7, $8, $9)
     RETURNING id::int AS id`,
    [
      w.chain,
      w.cinemaIds,
      w.dateFrom,
      w.dateTo,
      w.movieId ?? null,
      w.party ?? 2,
      w.minScore ?? 74,
      w.scoring ? JSON.stringify(w.scoring) : null,
      w.enabled ?? true,
    ],
  );
  return rows[0]!.id;
}

async function insertCachedSession(watchId: number, id: string, cinemaId: string): Promise<void> {
  await requirePool().query(
    `INSERT INTO sessions
       (id, watch_id, chain, movie_id, movie_name, cinema_id, cinema_name, date,
        start_time, format, screen, seats_available, booking_url, seat_allocation,
        fetched_at, last_seen)
     VALUES ($1, $2, 'event', 'M1', 'Test Movie', $3, $4, '2026-07-02',
             '2026-07-02T19:00:00.000Z', 'STANDARD', '3', 42, $5, true, now(), now())`,
    [id, watchId, cinemaId, `Cinema ${cinemaId}`, `https://book.example/${id}`],
  );
  await requirePool().query(
    `INSERT INTO session_seats (session_id, seat_id, row_label, row, col, area_kind, score)
     VALUES ($1, $2, 'A', 1, 1, 'standard', 90)`,
    [id, `${id}-A1`],
  );
}

async function watches(): Promise<WatchSummary[]> {
  const { rows } = await requirePool().query<WatchSummary>(
    `SELECT w.id::int AS id,
            w.chain,
            w.cinema_ids,
            w.movie_id,
            w.enabled,
            count(DISTINCT s.id)::int AS session_count,
            count(ss.seat_id)::int AS seat_count
       FROM watches w
       LEFT JOIN sessions s ON s.watch_id = w.id
       LEFT JOIN session_seats ss ON ss.session_id = s.id
      GROUP BY w.id
      ORDER BY w.chain, coalesce(w.movie_id, ''), array_to_string(w.cinema_ids, ',')`,
  );
  return rows;
}

function watchKey(row: Pick<WatchSummary, "chain" | "cinema_ids" | "movie_id">): string {
  return `${row.chain}|${[...row.cinema_ids].sort().join(",")}|${row.movie_id ?? ""}`;
}

function counts(result: unknown): Record<string, unknown> {
  assert.ok(result && typeof result === "object", "seedWatches must report C9 reconciliation counts");
  return result as Record<string, unknown>;
}

test("C9 reconciles watches.json as the authoritative enabled set and reports counts", { skip: dbSkip }, async () => {
  await resetToCurrentSchema();
  await insertWatch({ chain: "hoyts", cinemaIds: ["BROADW", "SHOWGR"], movieId: null, enabled: false });
  await insertWatch({ chain: "reading", cinemaIds: ["auburn"], movieId: null, enabled: true });
  await insertWatch({ chain: "village", cinemaIds: ["jamfactory"], movieId: null, enabled: true });

  const result = await seedWatches(requirePool(), [
    watchSeed({ chain: "event", cinemaIds: ["15", "66", "96"], movieId: null }),
    watchSeed({ chain: "hoyts", cinemaIds: ["BROADW", "SHOWGR"], movieId: null }),
    watchSeed({ chain: "reading", cinemaIds: ["auburn"], movieId: null }),
  ]);

  assert.deepEqual(counts(result), { inserted: 1, reEnabled: 1, disabled: 1, unchanged: 1 });

  const state = Object.fromEntries((await watches()).map((row) => [watchKey(row), row.enabled]));
  assert.deepEqual(state, {
    "event|15,66,96|": true,
    "hoyts|BROADW,SHOWGR|": true,
    "reading|auburn|": true,
    "village|jamfactory|": false,
  });
});

test(
  "C9 disables Event single-cinema orphans for a merged watch without deleting cached sessions",
  { skip: dbSkip },
  async () => {
    await resetToCurrentSchema();
    const georgeSt = await insertWatch({ chain: "event", cinemaIds: ["15"], movieId: null, enabled: true });
    const imax = await insertWatch({ chain: "event", cinemaIds: ["96"], movieId: null, enabled: true });
    await insertCachedSession(georgeSt, "event-15-cached", "15");
    await insertCachedSession(imax, "event-96-cached", "96");

    const result = await seedWatches(requirePool(), [
      watchSeed({ chain: "event", cinemaIds: ["15", "66", "96"], movieId: null }),
    ]);

    assert.deepEqual(counts(result), { inserted: 1, reEnabled: 0, disabled: 2, unchanged: 0 });

    const rows = await watches();
    assert.equal(rows.length, 3);
    assert.deepEqual(
      Object.fromEntries(rows.map((row) => [watchKey(row), row.enabled])),
      {
        "event|15|": false,
        "event|15,66,96|": true,
        "event|96|": false,
      },
    );

    const cachedRows = rows.filter((row) => row.session_count > 0);
    assert.deepEqual(
      cachedRows.map((row) => ({ key: watchKey(row), sessions: row.session_count, seats: row.seat_count })),
      [
        { key: "event|15|", sessions: 1, seats: 1 },
        { key: "event|96|", sessions: 1, seats: 1 },
      ],
      "orphan watches are disabled, not deleted, so cached sessions/session_seats stay attached",
    );
  },
);

test("C9 natural key uses chain, movieId, and cinemaIds as an order-insensitive sorted set", { skip: dbSkip }, async () => {
  await resetToCurrentSchema();
  await insertWatch({
    chain: "event",
    cinemaIds: ["15", "96"],
    dateFrom: "2026-06-01",
    dateTo: "2026-06-02",
    movieId: "M1",
    enabled: false,
  });

  const result = await seedWatches(requirePool(), [
    watchSeed({ chain: "event", cinemaIds: ["96", "15"], movieId: "M1" }),
    watchSeed({ chain: "event", cinemaIds: ["15", "66", "96"], movieId: "M1" }),
  ]);

  assert.deepEqual(counts(result), { inserted: 1, reEnabled: 1, disabled: 0, unchanged: 0 });

  const rows = await watches();
  assert.equal(rows.length, 2, "[96,15] must match existing [15,96], while [15,66,96] is distinct");
  assert.deepEqual(
    Object.fromEntries(rows.map((row) => [watchKey(row), row.enabled])),
    {
      "event|15,66,96|M1": true,
      "event|15,96|M1": true,
    },
  );
});

test("C9 rejects comma-containing cinemaId tokens and leaves the DB unchanged", { skip: dbSkip }, async () => {
  await resetToCurrentSchema();
  await insertWatch({ chain: "reading", cinemaIds: ["auburn"], movieId: null, enabled: true });

  let thrown: unknown;
  try {
    await seedWatches(requirePool(), [
      watchSeed({ chain: "hoyts", cinemaIds: ["BROADW"], movieId: null }),
      watchSeed({ chain: "event", cinemaIds: ["15,96"], movieId: null }),
    ]);
  } catch (err) {
    thrown = err;
  }

  assert.deepEqual(
    (await watches()).map((row) => ({ key: watchKey(row), enabled: row.enabled })),
    [{ key: "reading|auburn|", enabled: true }],
    "rejected seeds must be all-or-nothing: no inserts, re-enables, or disables persist",
  );
  assert.ok(thrown instanceof Error, "seedWatches must reject comma-containing cinemaId tokens");
  assert.match(thrown.message, /watches seed:.*cinemaIds.*comma/i);
});
