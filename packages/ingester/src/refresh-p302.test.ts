import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Chain, ChainAdapter, Cinema, Seat, SeatMap, Session, SessionQuery } from "@auscinema/core";
import { createPool, runRefreshTick, type AdapterRegistry, type WatchRow } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const hasDatabase = Boolean(databaseUrl);
const dbSkip = hasDatabase ? false : "DATABASE_URL is unset";
const schemaName = `p302_ingester_${process.pid}`;

let schemaSql = "";
let adminPool: ReturnType<typeof createPool> | undefined;
let pool: ReturnType<typeof createPool> | undefined;

type Pool = ReturnType<typeof createPool>;

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
    "refusing to run destructive P30.2 refresh tests against the live seatfinder database",
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

function hours(n: number): number {
  return n * 60 * 60_000;
}

function days(n: number): number {
  return n * 86_400_000;
}

function beforeInstant(now: Date, ageMs: number): Date {
  return new Date(now.getTime() - ageMs);
}

function seat(id: string, name: string, row: number, col: number, status: Seat["status"] = "available"): Seat {
  return { id, name, rowLabel: name[0] ?? "A", row, col, status, areaId: "1" };
}

function session(id: string, chain: Chain, cinemaId: string, startTime: string, overrides: Partial<Session> = {}): Session {
  return {
    chain,
    id,
    movieId: "M1",
    movieName: "Test Movie",
    cinemaId,
    cinemaName: `Cinema ${cinemaId}`,
    startTime,
    format: { kind: "standard", raw: "STANDARD" },
    screenName: "3",
    seatsAvailable: 42,
    seatAllocation: true,
    bookingUrl: `https://book.example/${id}`,
    ...overrides,
  };
}

function mapFor(chain: Chain, sessionId: string): SeatMap {
  return {
    chain,
    sessionId,
    screenName: "3",
    areas: [{ id: "1", name: "Stalls", code: "std", kind: "standard" }],
    seats: [seat(`${sessionId}-A1`, "A1", 1, 1), seat(`${sessionId}-A2`, "A2", 1, 2)],
  };
}

function stubAdapter(
  chain: Chain,
  sessions: Session[],
  maps: Record<string, SeatMap | Error>,
  captures: { queries?: SessionQuery[]; seatMapCalls?: string[] } = {},
): ChainAdapter {
  return {
    chain,
    async listCinemas(): Promise<Cinema[]> {
      return [];
    },
    async listSessions(q: SessionQuery): Promise<Session[]> {
      captures.queries?.push(q);
      return sessions;
    },
    async getSeatMap(sessionId: string): Promise<SeatMap> {
      captures.seatMapCalls?.push(sessionId);
      const plan = maps[sessionId];
      if (!plan) throw new Error(`no map for ${sessionId}`);
      if (plan instanceof Error) throw plan;
      return plan;
    },
  };
}

async function insertWatch(overrides: Partial<Omit<WatchRow, "id">> = {}): Promise<number> {
  const w: Omit<WatchRow, "id"> = {
    chain: "event",
    cinemaIds: ["C1"],
    dateFrom: "2026-10-05",
    dateTo: "2026-10-05",
    movieId: "M1",
    party: 2,
    minScore: 74,
    scoring: null,
    enabled: true,
    ...overrides,
  };
  const { rows } = await requirePool().query<{ id: string | number }>(
    `INSERT INTO watches (chain, cinema_ids, date_from, date_to, movie_id, party, min_score, scoring, enabled)
     VALUES ($1, $2::text[], $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      w.chain,
      w.cinemaIds,
      w.dateFrom,
      w.dateTo,
      w.movieId,
      w.party,
      w.minScore,
      w.scoring ? JSON.stringify(w.scoring) : null,
      w.enabled,
    ],
  );
  return Number(rows[0]!.id);
}

async function insertCachedSession(args: {
  id: string;
  watchId: number;
  chain?: Chain;
  cinemaId?: string;
  movieId?: string;
  date?: string;
  fetchedAt: Date;
  lastSeen?: Date;
  disappearedAt?: Date | null;
}): Promise<void> {
  const chain = args.chain ?? "event";
  const cinemaId = args.cinemaId ?? "C1";
  const movieId = args.movieId ?? "M1";
  const date = args.date ?? "2026-10-05";
  const lastSeen = args.lastSeen ?? args.fetchedAt;
  await requirePool().query(
    `INSERT INTO sessions
       (id, watch_id, chain, movie_id, movie_name, cinema_id, cinema_name, date,
        start_time, format, screen, seats_available, booking_url, seat_allocation,
        fetched_at, last_seen, disappeared_at)
     VALUES ($1,$2,$3,$4,'Test Movie',$5,$6,$7,$8,'STANDARD','3',42,$9,true,$10,$11,$12)`,
    [
      args.id,
      args.watchId,
      chain,
      movieId,
      cinemaId,
      `Cinema ${cinemaId}`,
      date,
      `${date}T19:00:00.000Z`,
      `https://book.example/${args.id}`,
      args.fetchedAt,
      lastSeen,
      args.disappearedAt ?? null,
    ],
  );
}

async function insertSeat(sessionId: string, seatId = `${sessionId}-A1`): Promise<void> {
  await requirePool().query(
    `INSERT INTO session_seats (session_id, seat_id, row_label, row, col, area_kind, score)
     VALUES ($1, $2, 'A', 1, 1, 'standard', 90)`,
    [sessionId, seatId],
  );
}

async function tombstoneRows(): Promise<Record<string, string | null>> {
  const { rows } = await requirePool().query<{ id: string; disappeared_at: string | null }>(
    `SELECT id,
            CASE WHEN disappeared_at IS NULL THEN NULL
                 ELSE to_char(disappeared_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            END AS disappeared_at
       FROM sessions
      ORDER BY id`,
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.disappeared_at]));
}

async function createPreP302Schema(): Promise<void> {
  await requirePool().query(`
    CREATE TABLE watches (
      id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      chain       TEXT        NOT NULL,
      cinema_ids  TEXT[]      NOT NULL,
      date_from   DATE        NOT NULL,
      date_to     DATE        NOT NULL,
      movie_id    TEXT,
      party       INTEGER     NOT NULL DEFAULT 2,
      min_score   INTEGER     NOT NULL DEFAULT 74,
      scoring     JSONB,
      enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE sessions (
      id               TEXT        PRIMARY KEY,
      watch_id         BIGINT      REFERENCES watches(id) ON DELETE SET NULL,
      chain            TEXT        NOT NULL,
      movie_id         TEXT        NOT NULL,
      movie_name       TEXT,
      cinema_id        TEXT        NOT NULL,
      cinema_name      TEXT,
      date             DATE        NOT NULL,
      start_time       TIMESTAMPTZ,
      format           TEXT,
      screen           TEXT,
      seats_available  INTEGER,
      booking_url      TEXT,
      seat_allocation  BOOLEAN,
      fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

type PurgeDisappearedSessions = (deps: {
  pool: Pool;
  nowInstant: Date;
  retentionMs: number;
}) => Promise<void>;

async function requirePurgeDisappearedSessions(): Promise<PurgeDisappearedSessions> {
  const mod = (await import("./index.js")) as Record<string, unknown>;
  assert.equal(
    typeof mod.purgeDisappearedSessions,
    "function",
    "P30.2 purge export must be purgeDisappearedSessions({ pool, nowInstant, retentionMs })",
  );
  return mod.purgeDisappearedSessions as PurgeDisappearedSessions;
}

test("C6 schema.sql contains an additive disappeared_at migration and an IF NOT EXISTS index", () => {
  assert.match(
    schemaSql,
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?sessions\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+disappeared_at\s+TIMESTAMPTZ\s+NULL/i,
    "schema.sql must add sessions.disappeared_at with ADD COLUMN IF NOT EXISTS",
  );
  assert.match(
    schemaSql,
    /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+\S+\s+ON\s+sessions\s*(?:USING\s+\w+\s*)?\([^;]*disappeared_at/i,
    "schema.sql must add a re-runnable sessions disappeared_at index",
  );
});

test("C6 migration adds nullable disappeared_at to an existing sessions table and is re-runnable", { skip: dbSkip }, async () => {
  await resetScopedSchema();
  await createPreP302Schema();
  const watchId = await insertWatch();
  await requirePool().query(
    `INSERT INTO sessions
       (id, watch_id, chain, movie_id, cinema_id, date, fetched_at, last_seen)
     VALUES ('pre-p302', $1, 'event', 'M1', 'C1', '2026-10-05', now(), now())`,
    [watchId],
  );

  await requirePool().query(schemaSql);
  await requirePool().query(schemaSql);

  const columns = await requirePool().query<{
    column_name: string;
    data_type: string;
    is_nullable: "YES" | "NO";
  }>(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'sessions' AND column_name = 'disappeared_at'`,
    [schemaName],
  );
  assert.deepEqual(columns.rows, [
    { column_name: "disappeared_at", data_type: "timestamp with time zone", is_nullable: "YES" },
  ]);

  const oldRows = await requirePool().query<{ id: string; disappeared_at: Date | null }>(
    "SELECT id, disappeared_at FROM sessions WHERE id = 'pre-p302'",
  );
  assert.equal(oldRows.rows[0]!.disappeared_at, null, "existing rows must get NULL");

  const indexes = await requirePool().query<{ indexdef: string }>(
    `SELECT indexdef
       FROM pg_indexes
      WHERE schemaname = $1 AND tablename = 'sessions' AND indexdef ILIKE '%disappeared_at%'`,
    [schemaName],
  );
  assert.ok(indexes.rows.length > 0, "sessions.disappeared_at must be indexed");
});

test("C6 discovery tombstones only in-scope absent sessions and keeps the due-ledger invariant", { skip: dbSkip }, async () => {
  await resetToCurrentSchema();
  const watchId = await insertWatch({ chain: "event", cinemaIds: ["C1"], dateFrom: "2026-10-05", dateTo: "2026-10-05" });
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  await insertCachedSession({ id: "present-live", watchId, fetchedAt: beforeInstant(nowInstant, hours(3)) });
  await insertCachedSession({ id: "gone-in-scope", watchId, fetchedAt: beforeInstant(nowInstant, hours(3)) });
  await insertCachedSession({
    id: "outside-unlisted-scope",
    watchId,
    cinemaId: "C2",
    fetchedAt: beforeInstant(nowInstant, hours(3)),
  });

  const captures = { queries: [] as SessionQuery[], seatMapCalls: [] as string[] };
  const registry: AdapterRegistry = {
    event: stubAdapter(
      "event",
      [session("present-live", "event", "C1", "2026-10-05T19:00:00.000Z")],
      { "present-live": mapFor("event", "present-live") },
      captures,
    ),
  };

  const row = await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 30 });

  assert.equal(row.outcome, "ok");
  assert.equal(row.sessions_disappeared, 1);
  assert.equal(row.sessions_due, 1, "the disappeared session is not part of the due set");
  assert.equal(row.sessions_refreshed, 1);
  assert.equal(row.errors, 0);
  assert.equal(row.sessions_skipped_budget, 0);
  assert.equal(
    row.sessions_due,
    row.sessions_refreshed + row.errors + row.sessions_skipped_budget,
    "sessions_due remains refreshed + errors + skipped when the tick also tombstones",
  );
  assert.deepEqual(captures.seatMapCalls, ["present-live"], "tombstoned sessions are not seatmap-refreshed");
  const queriedScopes = captures.queries.map((q) => `${q.cinemaIds.join(",")}|${q.date}`);
  assert.ok(queriedScopes.some((s) => s === "C1|2026-10-05"));
  assert.ok(queriedScopes.some((s) => s === "C1|2026-11-09"));
  assert.equal(queriedScopes.length, 36);

  const tombstones = await tombstoneRows();
  assert.equal(tombstones["gone-in-scope"], nowInstant.toISOString());
  assert.equal(tombstones["present-live"], null);
  assert.equal(tombstones["outside-unlisted-scope"], null, "sessions outside a listed scope are not tombstoned");
});

test(
  "C6 multi-cinema watch: a non-empty listing for one cinema does NOT tombstone cached sessions of another cinema absent from that listing",
  { skip: dbSkip },
  async () => {
    await resetToCurrentSchema();
    const watchId = await insertWatch({
      chain: "event",
      cinemaIds: ["C1", "C2"],
      dateFrom: "2026-10-05",
      dateTo: "2026-10-05",
    });
    const nowInstant = new Date("2026-10-05T00:00:00.000Z");
    await insertCachedSession({
      id: "c1-known",
      watchId,
      cinemaId: "C1",
      fetchedAt: beforeInstant(nowInstant, hours(3)),
    });
    await insertCachedSession({
      id: "c2-known",
      watchId,
      cinemaId: "C2",
      fetchedAt: beforeInstant(nowInstant, hours(3)),
    });

    const captures = { queries: [] as SessionQuery[], seatMapCalls: [] as string[] };
    const registry: AdapterRegistry = {
      event: stubAdapter(
        "event",
        [session("c1-known", "event", "C1", "2026-10-05T19:00:00.000Z")],
        { "c1-known": mapFor("event", "c1-known"), "c2-known": mapFor("event", "c2-known") },
        captures,
      ),
    };

    const row = await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 30 });

    assert.equal(row.outcome, "ok");
    assert.equal(row.sessions_disappeared, 0, "C2 is absent from the merged result, but C2 was not listed conclusively");
    assert.equal(row.sessions_due, 2, "both live cached sessions are due when neither is tombstoned");
    assert.equal(row.sessions_refreshed, 2);
    assert.equal(row.errors, 0);
    assert.equal(row.sessions_skipped_budget, 0);
    assert.equal(
      row.sessions_due,
      row.sessions_refreshed + row.errors + row.sessions_skipped_budget,
      "sessions_due remains refreshed + errors + skipped for a partial multi-cinema listing",
    );
    const queriedScopes = captures.queries.map((q) => `${q.cinemaIds.join(",")}|${q.date}`);
    assert.ok(queriedScopes.some((s) => s === "C1,C2|2026-10-05"));
    assert.ok(queriedScopes.some((s) => s === "C1,C2|2026-11-09"));
    assert.equal(queriedScopes.length, 36);
    assert.deepEqual(
      [...captures.seatMapCalls].sort(),
      ["c1-known", "c2-known"],
      "both live cached sessions are refreshed",
    );

    const tombstones = await tombstoneRows();
    assert.equal(tombstones["c1-known"], null, "returned C1 session stays live");
    assert.equal(tombstones["c2-known"], null, "absent C2 session stays live because C2 was not listed conclusively");
  },
);

test("C6 resurrection clears disappeared_at and makes the session live/due again", { skip: dbSkip }, async () => {
  await resetToCurrentSchema();
  const watchId = await insertWatch({ chain: "event", cinemaIds: ["C1"], dateFrom: "2026-10-05", dateTo: "2026-10-05" });
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  await insertCachedSession({
    id: "resurrected",
    watchId,
    fetchedAt: beforeInstant(nowInstant, hours(3)),
    disappearedAt: beforeInstant(nowInstant, days(2)),
  });

  const captures = { seatMapCalls: [] as string[] };
  const registry: AdapterRegistry = {
    event: stubAdapter(
      "event",
      [session("resurrected", "event", "C1", "2026-10-05T19:00:00.000Z")],
      { resurrected: mapFor("event", "resurrected") },
      captures,
    ),
  };

  const row = await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 30 });

  assert.equal(row.outcome, "ok");
  assert.equal(row.sessions_disappeared, 0);
  assert.equal(row.sessions_due, 1, "a reappeared tombstoned session is live/due again");
  assert.equal(row.sessions_refreshed, 1);
  assert.deepEqual(captures.seatMapCalls, ["resurrected"]);
  const tombstones = await tombstoneRows();
  assert.equal(tombstones.resurrected, null, "reappearing sessions clear disappeared_at");
});

test("C6 purge removes expired tombstoned sessions and cascades seats while retaining recent tombstones", { skip: dbSkip }, async () => {
  await resetToCurrentSchema();
  const purgeDisappearedSessions = await requirePurgeDisappearedSessions();
  const watchId = await insertWatch({ chain: "event", cinemaIds: ["C1"], dateFrom: "2026-10-05", dateTo: "2026-10-05" });
  const nowInstant = new Date("2026-10-20T00:00:00.000Z");
  await insertCachedSession({
    id: "expired-tombstone",
    watchId,
    fetchedAt: beforeInstant(nowInstant, days(40)),
    disappearedAt: beforeInstant(nowInstant, days(30)),
  });
  await insertCachedSession({
    id: "recent-tombstone",
    watchId,
    fetchedAt: beforeInstant(nowInstant, days(3)),
    disappearedAt: beforeInstant(nowInstant, days(2)),
  });
  await insertSeat("expired-tombstone");
  await insertSeat("recent-tombstone");

  await purgeDisappearedSessions({ pool: requirePool(), nowInstant, retentionMs: days(14) });

  const sessions = await requirePool().query<{ id: string }>("SELECT id FROM sessions ORDER BY id");
  assert.deepEqual(
    sessions.rows.map((r) => r.id),
    ["recent-tombstone"],
  );
  const seats = await requirePool().query<{ session_id: string; count: string }>(
    "SELECT session_id, count(*)::text AS count FROM session_seats GROUP BY session_id ORDER BY session_id",
  );
  assert.deepEqual(seats.rows, [{ session_id: "recent-tombstone", count: "1" }]);
});
