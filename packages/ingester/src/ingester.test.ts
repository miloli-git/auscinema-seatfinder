import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type {
  ChainAdapter,
  Cinema,
  Seat,
  SeatMap,
  Session,
  SessionQuery,
} from "@auscinema/core";
import {
  createPool,
  datesInRange,
  loadEnabledWatches,
  runSweep,
  sessionToUpsert,
  shouldBackoff,
  toSeatUpserts,
  upsertSessionWithSeats,
  watchToQuery,
  type AdapterRegistry,
  type SeatUpsert,
  type SessionUpsert,
  type SweepError,
  type SweepResult,
  type WatchRow,
} from "./index.js";

// --- Stubs ------------------------------------------------------------------

function seat(
  id: string,
  name: string,
  row: number,
  col: number,
  status: Seat["status"] = "available",
  overrides: Partial<Seat> = {},
): Seat {
  return { id, name, rowLabel: name[0] ?? "A", row, col, status, areaId: "1", ...overrides };
}

function session(id: string, startTime: string, seatAllocation = true, overrides: Partial<Session> = {}): Session {
  return {
    chain: "event",
    id,
    movieId: "M1",
    movieName: "Test Movie",
    cinemaId: "C1",
    cinemaName: "Test Cinema",
    startTime,
    format: { kind: "standard", raw: "STANDARD" },
    screenName: "3",
    seatsAvailable: 42,
    seatAllocation,
    bookingUrl: `https://book.example/${id}`,
    ...overrides,
  };
}

function mapWith(seats: Seat[], overrides: Partial<SeatMap> = {}): SeatMap {
  return {
    chain: "event",
    sessionId: "S1",
    screenName: "3",
    areas: [{ id: "1", name: "Stalls", code: "std", kind: "standard" }],
    seats,
    ...overrides,
  };
}

/** Adapter stub: fixed sessions + a per-sessionId seat map. */
function stubAdapter(
  sessions: Session[],
  maps: Record<string, SeatMap>,
  captures: { queries?: SessionQuery[]; seatMapCalls?: string[] } = {},
): ChainAdapter {
  return {
    chain: "event",
    async listCinemas(): Promise<Cinema[]> {
      return [];
    },
    async listSessions(q: SessionQuery): Promise<Session[]> {
      captures.queries?.push(q);
      return sessions;
    },
    async getSeatMap(sessionId: string): Promise<SeatMap> {
      captures.seatMapCalls?.push(sessionId);
      const m = maps[sessionId];
      if (!m) throw new Error(`no map for ${sessionId}`);
      return m;
    },
  };
}

function sampleAisleMap(sessionId = "S-FIXTURE"): SeatMap {
  return mapWith(
    [
      seat("s-f1", "F1", 5, 1, "available", { rowLabel: "F" }),
      seat("s-f2", "F2", 5, 2, "available", { rowLabel: "F" }),
      seat("s-f3", "F3", 5, 3, "available", { rowLabel: "F" }),
      seat("s-f4", "", 5, 4, "spacer", { rowLabel: "F" }),
      seat("s-f5", "F5", 5, 5, "sold", { rowLabel: "F" }),
      seat("s-f6", "F6", 5, 6, "available", { rowLabel: "F" }),
      seat("s-f7", "F7", 5, 7, "available", { rowLabel: "F" }),
    ],
    { sessionId },
  );
}

const seatRows: SeatUpsert[] = [
  { seatId: "A1", rowLabel: "A", row: 1, col: 1, areaKind: "standard", score: 76 },
  { seatId: "A2", rowLabel: "A", row: 1, col: 2, areaKind: "standard", score: 82 },
  { seatId: "A3", rowLabel: "A", row: 1, col: 3, areaKind: "standard", score: 78 },
];

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
    "refusing to run destructive ingester tests against the live seatfinder database",
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
});

after(async () => {
  await pool?.end();
});

async function insertWatch(overrides: Partial<Omit<WatchRow, "id">> = {}): Promise<number> {
  const w: Omit<WatchRow, "id"> = {
    chain: "event",
    cinemaIds: ["C1"],
    dateFrom: "2026-07-21",
    dateTo: "2026-07-21",
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

async function rowCount(table: "watches" | "sessions" | "session_seats" | "ingest_runs"): Promise<number> {
  const { rows } = await requirePool().query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
  return rows[0]!.count;
}

async function dbSession(watchId: number, id = "S-db"): Promise<SessionUpsert> {
  return sessionToUpsert(session(id, "2026-07-21T19:30"), watchId);
}

// --- Pure contract tests -----------------------------------------------------

test("datesInRange is inclusive, UTC-stable, and empty when from is after to", () => {
  assert.deepEqual(datesInRange("2026-06-24", "2026-06-26"), [
    "2026-06-24",
    "2026-06-25",
    "2026-06-26",
  ]);
  assert.deepEqual(datesInRange("2026-06-24", "2026-06-24"), ["2026-06-24"]);
  assert.deepEqual(datesInRange("2026-06-26", "2026-06-24"), []);
  assert.deepEqual(datesInRange("2026-12-31", "2027-01-02"), [
    "2026-12-31",
    "2027-01-01",
    "2027-01-02",
  ]);
});

test("watchToQuery maps null movieId to all-movies and passes set movieId through", () => {
  const base: WatchRow = {
    id: 1,
    chain: "event",
    cinemaIds: ["C1", "C2"],
    dateFrom: "2026-07-21",
    dateTo: "2026-07-21",
    movieId: null,
    party: 2,
    minScore: 74,
    scoring: null,
    enabled: true,
  };

  assert.deepEqual(watchToQuery(base, "2026-07-21"), {
    movieId: "",
    cinemaIds: ["C1", "C2"],
    date: "2026-07-21",
  });
  assert.equal(watchToQuery({ ...base, movieId: "M1" }, "2026-07-21").movieId, "M1");
});

test("toSeatUpserts stores available seats only and keeps scored zeroes", () => {
  const rows = toSeatUpserts(sampleAisleMap(), { allowedAreaKinds: ["goldclass"] });
  const ids = rows.map((r) => r.seatId).sort();

  assert.deepEqual(ids, ["s-f1", "s-f2", "s-f3", "s-f6", "s-f7"]);
  assert.equal(ids.includes("s-f4"), false, "spacer seat is absent");
  assert.equal(ids.includes("s-f5"), false, "sold seat is absent");
  assert.equal(rows.length, 5);
  assert.equal(rows.every((r) => r.areaKind === "standard"), true);
  assert.equal(rows.every((r) => typeof r.score === "number"), true);
  assert.equal(rows.every((r) => r.score === 0), true, "available seats are retained even with zero score");
});

test("toSeatUpserts returns an empty list for an all-sold seat map", () => {
  const rows = toSeatUpserts(
    mapWith([
      seat("A1", "A1", 1, 1, "sold"),
      seat("A2", "A2", 1, 2, "sold"),
      seat("A3", "A3", 1, 3, "spacer"),
    ]),
  );

  assert.deepEqual(rows, []);
});

test("shouldBackoff counts distinct failed watches", () => {
  const repeatedOneWatch: SweepError[] = [
    { watchId: 1, sessionId: "S1", error: "upstream" },
    { watchId: 1, sessionId: "S2", error: "upstream" },
  ];

  assert.equal(
    shouldBackoff({ errors: [{ watchId: 1, error: "upstream" }, { watchId: 2, error: "upstream" }] }, 2),
    true,
    "all watches failing triggers backoff",
  );
  assert.equal(
    shouldBackoff({ errors: repeatedOneWatch }, 3),
    false,
    "one failed watch with several session errors is not a majority",
  );
  assert.equal(
    shouldBackoff({ errors: [{ watchId: 1, error: "upstream" }, { watchId: 2, error: "upstream" }] }, 3),
    true,
    "strict majority failing triggers backoff",
  );
});

// --- DB-backed contract tests ------------------------------------------------

test("upsertSessionWithSeats inserts a session row and its scored seats", { skip: dbSkip }, async () => {
  const watchId = await insertWatch();
  const upsert = await dbSession(watchId);

  await upsertSessionWithSeats(requirePool(), upsert, seatRows);

  assert.equal(await rowCount("sessions"), 1);
  assert.equal(await rowCount("session_seats"), seatRows.length);

  const sessionRows = await requirePool().query<{
    id: string;
    watch_id: string;
    chain: string;
    movie_id: string;
    movie_name: string;
    cinema_id: string;
    cinema_name: string;
    date: string;
    format: string;
    screen: string;
    seats_available: number;
    booking_url: string;
    seat_allocation: boolean;
  }>(
    `SELECT id, watch_id, chain, movie_id, movie_name, cinema_id, cinema_name, date::text,
            format, screen, seats_available, booking_url, seat_allocation
       FROM sessions
      WHERE id = $1`,
    [upsert.id],
  );
  const storedSession = sessionRows.rows[0]!;
  assert.equal(storedSession.id, upsert.id);
  assert.equal(Number(storedSession.watch_id), watchId);
  assert.equal(storedSession.chain, "event");
  assert.equal(storedSession.movie_id, "M1");
  assert.equal(storedSession.movie_name, "Test Movie");
  assert.equal(storedSession.cinema_id, "C1");
  assert.equal(storedSession.cinema_name, "Test Cinema");
  assert.equal(storedSession.date, "2026-07-21");
  assert.equal(storedSession.format, "STANDARD");
  assert.equal(storedSession.screen, "3");
  assert.equal(storedSession.seats_available, 42);
  assert.equal(storedSession.booking_url, "https://book.example/S-db");
  assert.equal(storedSession.seat_allocation, true);

  const seatResult = await requirePool().query<{
    seat_id: string;
    row_label: string;
    row: number;
    col: number;
    area_kind: string;
    score: number;
  }>(
    `SELECT seat_id, row_label, row, col, area_kind, score
       FROM session_seats
      WHERE session_id = $1 AND seat_id = $2`,
    [upsert.id, "A2"],
  );
  assert.deepEqual(seatResult.rows[0], {
    seat_id: "A2",
    row_label: "A",
    row: 1,
    col: 2,
    area_kind: "standard",
    score: 82,
  });
});

test("upsertSessionWithSeats is idempotent for the same session and seats", { skip: dbSkip }, async () => {
  const watchId = await insertWatch();
  const upsert = await dbSession(watchId);

  await upsertSessionWithSeats(requirePool(), upsert, seatRows);
  await upsertSessionWithSeats(requirePool(), upsert, seatRows);

  assert.equal(await rowCount("sessions"), 1);
  assert.equal(await rowCount("session_seats"), seatRows.length);
});

test("upsertSessionWithSeats replaces a session's seats instead of appending", { skip: dbSkip }, async () => {
  const watchId = await insertWatch();
  const upsert = await dbSession(watchId);

  await upsertSessionWithSeats(requirePool(), upsert, seatRows);
  const firstSeen = await requirePool().query<{ last_seen: Date }>(
    "SELECT last_seen FROM sessions WHERE id = $1",
    [upsert.id],
  );
  await new Promise((resolve) => setTimeout(resolve, 20));

  const replacement: SeatUpsert[] = [
    { seatId: "B8", rowLabel: "B", row: 2, col: 8, areaKind: "standard", score: 91 },
  ];
  await upsertSessionWithSeats(requirePool(), upsert, replacement);

  assert.equal(await rowCount("sessions"), 1);
  assert.equal(await rowCount("session_seats"), 1);
  const stored = await requirePool().query<{ seat_id: string; last_seen: Date }>(
    `SELECT ss.seat_id, s.last_seen
       FROM sessions s
       JOIN session_seats ss ON ss.session_id = s.id
      WHERE s.id = $1`,
    [upsert.id],
  );
  assert.deepEqual(stored.rows.map((r) => r.seat_id), ["B8"]);
  assert.ok(stored.rows[0]!.last_seen > firstSeen.rows[0]!.last_seen, "last_seen is refreshed");
});

test("upsertSessionWithSeats persists an all-sold session with zero seats", { skip: dbSkip }, async () => {
  const watchId = await insertWatch();
  const upsert = await dbSession(watchId);

  await upsertSessionWithSeats(requirePool(), upsert, []);

  assert.equal(await rowCount("sessions"), 1);
  assert.equal(await rowCount("session_seats"), 0);
});

test("runSweep upserts sessions and finishes exactly one ingest run", { skip: dbSkip }, async () => {
  await insertWatch();
  const sessions = [session("S1", "2026-07-21T18:30"), session("S2", "2026-07-21T20:30")];
  const maps = {
    S1: mapWith([seat("S1-A1", "A1", 1, 1), seat("S1-A2", "A2", 1, 2)], { sessionId: "S1" }),
    S2: mapWith([seat("S2-A1", "A1", 1, 1), seat("S2-A2", "A2", 1, 2)], { sessionId: "S2" }),
  };
  const registry: AdapterRegistry = { event: stubAdapter(sessions, maps) };

  const result: SweepResult = await runSweep({ pool: requirePool(), registry, concurrency: 2 });

  assert.equal(result.watches, 1);
  assert.equal(result.sessionsUpserted, 2);
  assert.equal(result.seatmapsFetched, 2);
  assert.deepEqual(result.errors, []);
  assert.equal(await rowCount("sessions"), 2);
  assert.equal(await rowCount("session_seats"), 4);

  const runs = await requirePool().query<{
    watches: number;
    sessions_upserted: number;
    seatmaps_fetched: number;
    errors: number;
    finished_at: Date | null;
  }>("SELECT watches, sessions_upserted, seatmaps_fetched, errors, finished_at FROM ingest_runs");
  assert.equal(runs.rows.length, 1);
  assert.ok(runs.rows[0]!.finished_at);
  assert.deepEqual(
    {
      watches: runs.rows[0]!.watches,
      sessionsUpserted: runs.rows[0]!.sessions_upserted,
      seatmapsFetched: runs.rows[0]!.seatmaps_fetched,
      errors: runs.rows[0]!.errors,
    },
    {
      watches: result.watches,
      sessionsUpserted: result.sessionsUpserted,
      seatmapsFetched: result.seatmapsFetched,
      errors: result.errors.length,
    },
  );
});

test("runSweep isolates a mid-sweep getSeatMap failure", { skip: dbSkip }, async () => {
  await insertWatch();
  const sessions = [session("Sbad", "2026-07-21T18:30"), session("Sgood", "2026-07-21T20:30")];
  const registry: AdapterRegistry = {
    event: stubAdapter(sessions, {
      Sgood: mapWith([seat("good", "D3", 3, 2)], { sessionId: "Sgood" }),
    }),
  };

  const result = await runSweep({ pool: requirePool(), registry, concurrency: 2 });

  assert.equal(result.sessionsUpserted, 1);
  assert.equal(result.seatmapsFetched, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.sessionId, "Sbad");
  assert.equal(await rowCount("sessions"), 1);

  const runs = await requirePool().query<{ errors: number; sessions_upserted: number }>(
    "SELECT errors, sessions_upserted FROM ingest_runs",
  );
  assert.equal(runs.rows[0]!.errors, 1);
  assert.equal(runs.rows[0]!.sessions_upserted, 1);
});

test("runSweep passes null and set movieId values through listSessions correctly", { skip: dbSkip }, async () => {
  await insertWatch({ movieId: null });
  await insertWatch({ movieId: "M1" });
  const queries: SessionQuery[] = [];
  const registry: AdapterRegistry = { event: stubAdapter([], {}, { queries }) };

  await runSweep({ pool: requirePool(), registry });

  assert.equal(queries.length, 2);
  assert.deepEqual(
    queries.map((q) => q.movieId),
    ["", "M1"],
  );
});

test("runSweep stores aisle and sold-seat gaps as absent columns", { skip: dbSkip }, async () => {
  await insertWatch();
  const registry: AdapterRegistry = {
    event: stubAdapter([session("S-FIXTURE", "2026-07-21T19:30")], {
      "S-FIXTURE": sampleAisleMap(),
    }),
  };

  await runSweep({ pool: requirePool(), registry });

  const stored = await requirePool().query<{ col: number }>(
    "SELECT col FROM session_seats WHERE session_id = $1 ORDER BY col",
    ["S-FIXTURE"],
  );
  assert.deepEqual(
    stored.rows.map((r) => r.col),
    [1, 2, 3, 6, 7],
  );
});

test("runSweep is idempotent across repeated sweeps and writes one run per sweep", { skip: dbSkip }, async () => {
  await insertWatch();
  const sessions = [session("S1", "2026-07-21T18:30"), session("S2", "2026-07-21T20:30")];
  const maps = {
    S1: mapWith([seat("S1-A1", "A1", 1, 1), seat("S1-A2", "A2", 1, 2)], { sessionId: "S1" }),
    S2: mapWith([seat("S2-A1", "A1", 1, 1), seat("S2-A2", "A2", 1, 2)], { sessionId: "S2" }),
  };
  const registry: AdapterRegistry = { event: stubAdapter(sessions, maps) };

  const first = await runSweep({ pool: requirePool(), registry, concurrency: 2 });
  const countsAfterFirst = {
    sessions: await rowCount("sessions"),
    seats: await rowCount("session_seats"),
  };
  const second = await runSweep({ pool: requirePool(), registry, concurrency: 2 });

  assert.equal(first.sessionsUpserted, 2);
  assert.equal(second.sessionsUpserted, 2);
  assert.deepEqual(
    {
      sessions: await rowCount("sessions"),
      seats: await rowCount("session_seats"),
    },
    countsAfterFirst,
  );
  assert.equal(await rowCount("ingest_runs"), 2);
});

test("runSweep respects maxSeatmapsPerWatch", { skip: dbSkip }, async () => {
  await insertWatch();
  const sessions = Array.from({ length: 5 }, (_, i) => session(`S${i + 1}`, `2026-07-21T1${i}:30`));
  const maps = Object.fromEntries(
    sessions.map((s) => [s.id, mapWith([seat(`${s.id}-A1`, "A1", 1, 1)], { sessionId: s.id })]),
  );
  const seatMapCalls: string[] = [];
  const registry: AdapterRegistry = { event: stubAdapter(sessions, maps, { seatMapCalls }) };

  const result = await runSweep({ pool: requirePool(), registry, maxSeatmapsPerWatch: 2 });

  assert.equal(result.seatmapsFetched, 2);
  assert.equal(result.sessionsUpserted, 2);
  assert.equal(seatMapCalls.length, 2);
  assert.ok(result.seatmapsFetched <= 2);
});

test("runSweep skips disabled watches", { skip: dbSkip }, async () => {
  const enabledId = await insertWatch({ movieId: "M-enabled", enabled: true });
  await insertWatch({ movieId: "M-disabled", enabled: false });
  const queries: SessionQuery[] = [];
  const registry: AdapterRegistry = {
    event: stubAdapter(
      [session("S-enabled", "2026-07-21T19:30")],
      { "S-enabled": mapWith([seat("A1", "A1", 1, 1)], { sessionId: "S-enabled" }) },
      { queries },
    ),
  };

  const enabled = await loadEnabledWatches(requirePool());
  const result = await runSweep({ pool: requirePool(), registry });

  assert.deepEqual(
    enabled.map((w) => w.id),
    [enabledId],
  );
  assert.equal(queries.length, 1);
  assert.equal(queries[0]!.movieId, "M-enabled");
  assert.equal(result.watches, 1);
  assert.equal(result.sessionsUpserted, 1);
});
