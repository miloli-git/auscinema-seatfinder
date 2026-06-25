import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPool } from "@auscinema/ingester";
import { buildServer } from "./index.js";

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
  await pool.query("TRUNCATE watches, sessions, session_seats, ingest_runs, refresh_runs RESTART IDENTITY CASCADE");
});

after(async () => {
  await pool?.end();
});

type SessionSeed = {
  id?: string;
  chain?: string;
  movieId?: string;
  movieName?: string | null;
  cinemaId?: string;
  cinemaName?: string | null;
  date?: string;
  startTime?: string | null;
  format?: string | null;
  screen?: string | null;
  seatsAvailable?: number | null;
  bookingUrl?: string | null;
  seatAllocation?: boolean | null;
  fetchedAt?: string;
};

type InsertedSession = Required<SessionSeed>;

type SeatSeed = {
  seatId: string;
  rowLabel?: string | null;
  row?: number;
  col: number;
  areaKind?: string | null;
  score: number;
};

type TogetherResponse = {
  party: number;
  minScore: number;
  count: number;
  results: Array<{
    session: {
      id: string;
      chain: string;
      movieId: string;
      movieName: string | null;
      cinemaId: string;
      cinemaName: string | null;
      date: string;
      startTime: string | null;
      format: string | null;
      screen: string | null;
      seatsAvailable: number | null;
      bookingUrl: string | null;
      seatAllocation: boolean | null;
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
};

type CatalogResponse = {
  movies: Array<{ id: string; name: string | null; chain: string }>;
  cinemas: Array<{ id: string; name: string | null; chain: string }>;
  dates: string[];
};

async function insertSession(overrides: SessionSeed = {}): Promise<InsertedSession> {
  const id = overrides.id ?? "S1";
  const session: InsertedSession = {
    id,
    chain: "event",
    movieId: "M1",
    movieName: "Test Movie",
    cinemaId: "C1",
    cinemaName: "Test Cinema",
    date: "2099-06-25",
    startTime: "2099-06-25T19:30:00.000Z",
    format: "V-Max",
    screen: "3",
    seatsAvailable: 142,
    bookingUrl: `https://example.test/book?sid=${id}`,
    seatAllocation: true,
    fetchedAt: "2099-06-24T09:00:00.000Z",
    ...overrides,
  };

  await requirePool().query(
    `INSERT INTO sessions
       (id, chain, movie_id, movie_name, cinema_id, cinema_name, date, start_time,
        format, screen, seats_available, booking_url, seat_allocation, fetched_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      session.id,
      session.chain,
      session.movieId,
      session.movieName,
      session.cinemaId,
      session.cinemaName,
      session.date,
      session.startTime,
      session.format,
      session.screen,
      session.seatsAvailable,
      session.bookingUrl,
      session.seatAllocation,
      session.fetchedAt,
    ],
  );
  return session;
}

async function insertSeats(sessionId: string, seats: readonly SeatSeed[]): Promise<void> {
  for (const seat of seats) {
    await requirePool().query(
      `INSERT INTO session_seats (session_id, seat_id, row_label, row, col, area_kind, score)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        sessionId,
        seat.seatId,
        seat.rowLabel ?? "A",
        seat.row ?? 1,
        seat.col,
        seat.areaKind ?? "standard",
        seat.score,
      ],
    );
  }
}

async function getTogether(query: string): Promise<TogetherResponse> {
  const server = buildServer({ pool: requirePool(), rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: `/together?${query}` });
  assert.equal(res.statusCode, 200);
  return res.json() as TogetherResponse;
}

async function getCatalog(query = ""): Promise<CatalogResponse> {
  const server = buildServer({ pool: requirePool(), rateLimit: false, logger: false });
  const suffix = query.length > 0 ? `?${query}` : "";
  const res = await server.inject({ method: "GET", url: `/catalog${suffix}` });
  assert.equal(res.statusCode, 200);
  return res.json() as CatalogResponse;
}

function assertTogetherShape(body: TogetherResponse): void {
  // P30.3 (C7): /together carries an additive top-level `freshness` object. Existing keys unchanged.
  assert.deepEqual(Object.keys(body).sort(), ["count", "freshness", "minScore", "party", "results"]);
  for (const result of body.results) {
    assert.deepEqual(Object.keys(result).sort(), ["approximateAdjacency", "block", "fetchedAt", "session"]);
    assert.deepEqual(Object.keys(result.session).sort(), [
      "bookingUrl",
      "chain",
      "cinemaId",
      "cinemaName",
      "date",
      "format",
      "id",
      "movieId",
      "movieName",
      "screen",
      "seatAllocation",
      "seatsAvailable",
      "startTime",
    ]);
    if (result.block !== null) {
      assert.deepEqual(Object.keys(result.block).sort(), ["avgScore", "minScore", "row", "rowLabel", "seatIds", "startCol"]);
    }
  }
}

function assertCatalogShape(body: CatalogResponse): void {
  assert.deepEqual(Object.keys(body).sort(), ["cinemas", "dates", "movies"]);
  for (const movie of body.movies) assert.deepEqual(Object.keys(movie).sort(), ["chain", "id", "name"]);
  for (const cinema of body.cinemas) assert.deepEqual(Object.keys(cinema).sort(), ["chain", "id", "name"]);
}

function resultIds(body: TogetherResponse): string[] {
  return body.results.map((r) => r.session.id);
}

test("/together missing chain -> 400 {error}", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: "/together" });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: "missing required query param: chain" });
});

test("/together with no pool configured -> 503 {error}", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: "/together?chain=event" });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { error: "database not configured" });
});

test("/together happy path returns one adjacent in-zone pair", { skip: dbSkip }, async () => {
  const session = await insertSession({
    id: "happy",
    movieId: "M-happy",
    movieName: "The Odyssey",
    cinemaId: "15",
    cinemaName: "Event Cinemas George Street",
    date: "2099-06-25",
    startTime: "2099-06-25T19:30:00.000Z",
    fetchedAt: "2099-06-24T09:00:00.000Z",
  });
  await insertSeats(session.id, [
    { seatId: "s-h10", rowLabel: "H", row: 8, col: 10, score: 94 },
    { seatId: "s-h11", rowLabel: "H", row: 8, col: 11, score: 98 },
    { seatId: "s-h12", rowLabel: "H", row: 8, col: 12, score: 50 },
  ]);

  const body = await getTogether("chain=event&party=2&minScore=74");

  assertTogetherShape(body);
  assert.equal(body.party, 2);
  assert.equal(body.minScore, 74);
  assert.equal(body.count, 1);
  assert.equal(body.count, body.results.length);
  assert.deepEqual(body.results[0]!.session, {
    id: "happy",
    chain: "event",
    movieId: "M-happy",
    movieName: "The Odyssey",
    cinemaId: "15",
    cinemaName: "Event Cinemas George Street",
    date: "2099-06-25",
    startTime: "2099-06-25T19:30:00.000Z",
    format: "V-Max",
    screen: "3",
    seatsAvailable: 142,
    bookingUrl: "https://example.test/book?sid=happy",
    seatAllocation: true,
  });
  assert.deepEqual(body.results[0]!.block, {
    row: 8,
    rowLabel: "H",
    startCol: 10,
    seatIds: ["s-h10", "s-h11"],
    avgScore: 96,
    minScore: 94,
  });
  assert.equal(body.results[0]!.approximateAdjacency, false);
  assert.equal(body.results[0]!.fetchedAt, "2099-06-24T09:00:00.000Z");
});

test("/together ranks by block avgScore desc, startTime asc, then session id", { skip: dbSkip }, async () => {
  const sessions = [
    { id: "rank-low", startTime: "2099-06-25T17:00:00.000Z", scores: [88, 88] },
    { id: "rank-late", startTime: "2099-06-25T20:00:00.000Z", scores: [90, 90] },
    { id: "rank-z", startTime: "2099-06-25T18:00:00.000Z", scores: [90, 90] },
    { id: "rank-a", startTime: "2099-06-25T18:00:00.000Z", scores: [90, 90] },
    { id: "rank-best", startTime: "2099-06-25T21:00:00.000Z", scores: [96, 96] },
  ];
  for (const s of sessions) {
    await insertSession({ id: s.id, startTime: s.startTime });
    await insertSeats(s.id, [
      { seatId: `${s.id}-1`, col: 1, score: s.scores[0]! },
      { seatId: `${s.id}-2`, col: 2, score: s.scores[1]! },
    ]);
  }

  const body = await getTogether("chain=event&party=2&minScore=74");

  assertTogetherShape(body);
  assert.deepEqual(resultIds(body), ["rank-best", "rank-a", "rank-z", "rank-late", "rank-low"]);
});

test("/together cinemaIds includes requested cinemas and excludes others", { skip: dbSkip }, async () => {
  for (const cinemaId of ["a", "b", "c"]) {
    const id = `cinema-${cinemaId}`;
    await insertSession({ id, cinemaId });
    await insertSeats(id, [
      { seatId: `${id}-1`, col: 1, score: 80 },
      { seatId: `${id}-2`, col: 2, score: 80 },
    ]);
  }

  const body = await getTogether("chain=event&cinemaIds=a,,b,&party=2");

  assertTogetherShape(body);
  assert.deepEqual(resultIds(body), ["cinema-a", "cinema-b"]);
});

test("/together dateFrom/dateTo boundaries are inclusive", { skip: dbSkip }, async () => {
  for (const [id, date] of [
    ["outside-before", "2099-06-24"],
    ["on-from", "2099-06-25"],
    ["on-to", "2099-06-27"],
    ["outside-after", "2099-06-28"],
  ] as const) {
    await insertSession({ id, date, startTime: `${date}T12:00:00.000Z` });
    await insertSeats(id, [
      { seatId: `${id}-1`, col: 1, score: 82 },
      { seatId: `${id}-2`, col: 2, score: 82 },
    ]);
  }

  const body = await getTogether("chain=event&dateFrom=2099-06-25&dateTo=2099-06-27");

  assertTogetherShape(body);
  assert.deepEqual(resultIds(body).sort(), ["on-from", "on-to"]);
});

test("/together movieId filter returns only that movie", { skip: dbSkip }, async () => {
  for (const movieId of ["target", "other"]) {
    const id = `movie-${movieId}`;
    await insertSession({ id, movieId });
    await insertSeats(id, [
      { seatId: `${id}-1`, col: 1, score: 80 },
      { seatId: `${id}-2`, col: 2, score: 80 },
    ]);
  }

  const body = await getTogether("chain=event&movieId=target");

  assertTogetherShape(body);
  assert.deepEqual(resultIds(body), ["movie-target"]);
});

test("/together party larger than any block returns the session with block:null", { skip: dbSkip }, async () => {
  await insertSession({ id: "small-block" });
  await insertSeats("small-block", [
    { seatId: "small-1", col: 1, score: 90 },
    { seatId: "small-2", col: 2, score: 90 },
  ]);

  const body = await getTogether("chain=event&party=5");

  assertTogetherShape(body);
  assert.equal(body.party, 5);
  assert.equal(body.minScore, 74);
  assert.equal(body.count, 1);
  assert.equal(body.results[0]!.session.id, "small-block");
  assert.equal(body.results[0]!.block, null);
});

test("/together minScore above every seat score returns the session with block:null", { skip: dbSkip }, async () => {
  await insertSession({ id: "below-threshold" });
  await insertSeats("below-threshold", [
    { seatId: "below-1", col: 1, score: 80 },
    { seatId: "below-2", col: 2, score: 81 },
  ]);

  const body = await getTogether("chain=event&minScore=99");

  assertTogetherShape(body);
  assert.equal(body.minScore, 99);
  assert.equal(body.count, 1);
  assert.equal(body.results[0]!.session.id, "below-threshold");
  assert.equal(body.results[0]!.block, null);
});

test("/together unknown movieId filter returns an empty result", { skip: dbSkip }, async () => {
  await insertSession({ id: "known-movie", movieId: "known" });
  await insertSeats("known-movie", [
    { seatId: "known-1", col: 1, score: 90 },
    { seatId: "known-2", col: 2, score: 90 },
  ]);

  const body = await getTogether("chain=event&movieId=unknown");

  assert.deepEqual(body, {
    party: 2,
    minScore: 74,
    count: 0,
    results: [],
    // P30.3 (C7): no watch + empty refresh_runs ledger in this suite -> not_cached, null instants.
    freshness: {
      oldestFetchedAt: null,
      newestFetchedAt: null,
      lastSuccessfulIngestAt: null,
      coverage: { event: "not_cached" },
    },
  });
});

test("/together matched session with zero session_seats returns the session with block:null", { skip: dbSkip }, async () => {
  // Zero scored/available seats = a sold-out (or not-yet-bookable) session. Post-#39 the matrix
  // needs it surfaced as "sold" (session present, block:null), not dropped (which reads as "—").
  await insertSession({ id: "empty-seatmap" });

  const body = await getTogether("chain=event");

  assertTogetherShape(body);
  assert.equal(body.count, 1);
  assert.equal(body.results[0]!.session.id, "empty-seatmap");
  assert.equal(body.results[0]!.block, null);
});

test("/together defaults party to 2 and minScore to 74", { skip: dbSkip }, async () => {
  await insertSession({ id: "defaults" });
  await insertSeats("defaults", [
    { seatId: "defaults-1", col: 1, score: 74 },
    { seatId: "defaults-2", col: 2, score: 75 },
  ]);

  const body = await getTogether("chain=event");

  assertTogetherShape(body);
  assert.equal(body.party, 2);
  assert.equal(body.minScore, 74);
  assert.equal(body.count, 1);
  assert.deepEqual(body.results[0]!.block!.seatIds, ["defaults-1", "defaults-2"]);
});

test("/together clamps party below 1 to a single-seat block", { skip: dbSkip }, async () => {
  await insertSession({ id: "single-seat" });
  await insertSeats("single-seat", [{ seatId: "single-1", rowLabel: "D", row: 4, col: 7, score: 83 }]);

  const body = await getTogether("chain=event&party=0");

  assertTogetherShape(body);
  assert.equal(body.party, 1);
  assert.equal(body.count, 1);
  assert.deepEqual(body.results[0]!.block, {
    row: 4,
    rowLabel: "D",
    startCol: 7,
    seatIds: ["single-1"],
    avgScore: 83,
    minScore: 83,
  });
});

test("/together missing column breaks adjacency -> block:null", { skip: dbSkip }, async () => {
  await insertSession({ id: "gap" });
  await insertSeats("gap", [
    { seatId: "gap-1", col: 1, score: 95 },
    { seatId: "gap-3", col: 3, score: 95 },
  ]);

  const body = await getTogether("chain=event&party=2");

  assertTogetherShape(body);
  assert.equal(body.count, 1);
  assert.equal(body.results[0]!.session.id, "gap");
  assert.equal(body.results[0]!.block, null);
});

test("/together flags Hoyts adjacency as approximate and Event as exact", { skip: dbSkip }, async () => {
  for (const [chain, id] of [
    ["hoyts", "hoyts-session"],
    ["event", "event-session"],
  ] as const) {
    await insertSession({ id, chain });
    await insertSeats(id, [
      { seatId: `${id}-1`, col: 1, score: 90 },
      { seatId: `${id}-2`, col: 2, score: 90 },
    ]);
  }

  const hoyts = await getTogether("chain=hoyts");
  const event = await getTogether("chain=event");

  assertTogetherShape(hoyts);
  assertTogetherShape(event);
  assert.equal(hoyts.results[0]!.approximateAdjacency, true);
  assert.equal(event.results[0]!.approximateAdjacency, false);
});

test("/catalog returns distinct sorted movies, cinemas, and dates", { skip: dbSkip }, async () => {
  await insertSession({
    id: "catalog-zed-1",
    chain: "event",
    movieId: "M-Z",
    movieName: "Zed",
    cinemaId: "C-Z",
    cinemaName: "Z Cinema",
    date: "2099-06-26",
  });
  await insertSession({
    id: "catalog-zed-2",
    chain: "event",
    movieId: "M-Z",
    movieName: "Zed",
    cinemaId: "C-Z",
    cinemaName: "Z Cinema",
    date: "2099-06-26",
  });
  await insertSession({
    id: "catalog-alpha",
    chain: "event",
    movieId: "M-A",
    movieName: "Alpha",
    cinemaId: "C-A",
    cinemaName: "Alpha Cinema",
    date: "2099-06-25",
  });
  await insertSession({
    id: "catalog-beta",
    chain: "hoyts",
    movieId: "M-B",
    movieName: "Beta",
    cinemaId: "H-B",
    cinemaName: "Hoyts Broadway",
    date: "2099-06-27",
  });

  const body = await getCatalog();

  assertCatalogShape(body);
  assert.deepEqual(body, {
    movies: [
      { id: "M-A", name: "Alpha", chain: "event" },
      { id: "M-B", name: "Beta", chain: "hoyts" },
      { id: "M-Z", name: "Zed", chain: "event" },
    ],
    cinemas: [
      { id: "C-A", name: "Alpha Cinema", chain: "event" },
      { id: "H-B", name: "Hoyts Broadway", chain: "hoyts" },
      { id: "C-Z", name: "Z Cinema", chain: "event" },
    ],
    dates: ["2099-06-25", "2099-06-26", "2099-06-27"],
  });
});

test("/catalog?chain=event scopes movies, cinemas, and dates to that chain", { skip: dbSkip }, async () => {
  await insertSession({
    id: "catalog-event",
    chain: "event",
    movieId: "M-event",
    movieName: "Event Movie",
    cinemaId: "C-event",
    cinemaName: "Event Cinema",
    date: "2099-06-25",
  });
  await insertSession({
    id: "catalog-hoyts",
    chain: "hoyts",
    movieId: "M-hoyts",
    movieName: "Hoyts Movie",
    cinemaId: "C-hoyts",
    cinemaName: "Hoyts Cinema",
    date: "2099-06-26",
  });

  const body = await getCatalog("chain=event");

  assertCatalogShape(body);
  assert.deepEqual(body, {
    movies: [{ id: "M-event", name: "Event Movie", chain: "event" }],
    cinemas: [{ id: "C-event", name: "Event Cinema", chain: "event" }],
    dates: ["2099-06-25"],
  });
});

test("/catalog on an empty DB returns empty arrays", { skip: dbSkip }, async () => {
  const body = await getCatalog();

  assert.deepEqual(body, { movies: [], cinemas: [], dates: [] });
});

test("/catalog with no pool configured -> 503 {error}", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: "/catalog" });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { error: "database not configured" });
});

test("/together treats SQL injection text as a literal filter value", { skip: dbSkip }, async () => {
  await insertSession({ id: "literal-movie", movieId: "1" });
  await insertSeats("literal-movie", [
    { seatId: "literal-1", col: 1, score: 90 },
    { seatId: "literal-2", col: 2, score: 90 },
  ]);

  const injection = encodeURIComponent("1') OR ('1'='1");
  const body = await getTogether(`chain=event&movieId=${injection}`);

  assert.deepEqual(body, {
    party: 2,
    minScore: 74,
    count: 0,
    results: [],
    // P30.3 (C7): no watch + empty refresh_runs ledger in this suite -> not_cached, null instants.
    freshness: {
      oldestFetchedAt: null,
      newestFetchedAt: null,
      lastSuccessfulIngestAt: null,
      coverage: { event: "not_cached" },
    },
  });
});

// --- #39 (ST-4 Layer 1): matched no-block sessions are returned with block:null ---------------
// Contract (docs/ST-4-tdd-plan.md §"Layer 1 (#39)"): every matched session is returned; a session
// with no adjacency block >= party at minScore keeps its `session` and sets `block: null`. The
// `—` (no-session) case is the ABSENCE of a result, never a synthesised null row.

test("L1.1 returns matched session with block === null when the session has no available block", { skip: dbSkip }, async () => {
  // Seats exist but a column gap (col 2 sold/absent) means no party-sized adjacent run forms.
  await insertSession({ id: "l1-noblock" });
  await insertSeats("l1-noblock", [
    { seatId: "l1nb-1", rowLabel: "A", row: 1, col: 1, score: 95 },
    { seatId: "l1nb-3", rowLabel: "A", row: 1, col: 3, score: 95 },
  ]);

  const body = await getTogether("chain=event&party=2&minScore=74");

  assertTogetherShape(body);
  assert.equal(body.count, 1);
  assert.equal(body.results.length, 1);
  const result = body.results[0]!;
  assert.equal(result.session.id, "l1-noblock");
  assert.equal(result.block, null);
  assert.equal(result.approximateAdjacency, false);
  assert.equal(result.fetchedAt, "2099-06-24T09:00:00.000Z");
});

test("L1.2 still returns block for sessions that have one (no regression)", { skip: dbSkip }, async () => {
  await insertSession({ id: "l1-block" });
  await insertSeats("l1-block", [
    { seatId: "l1b-1", rowLabel: "C", row: 3, col: 5, score: 88 },
    { seatId: "l1b-2", rowLabel: "C", row: 3, col: 6, score: 92 },
  ]);

  const body = await getTogether("chain=event&party=2&minScore=74");

  assertTogetherShape(body);
  assert.equal(body.count, 1);
  assert.deepEqual(body.results[0]!.block, {
    row: 3,
    rowLabel: "C",
    startCol: 5,
    seatIds: ["l1b-1", "l1b-2"],
    avgScore: 90,
    minScore: 88,
  });
});

test("L1.3 count includes blockless sessions; results length === count", { skip: dbSkip }, async () => {
  await insertSession({ id: "l3-block", startTime: "2099-06-25T18:00:00.000Z" });
  await insertSeats("l3-block", [
    { seatId: "l3b-1", col: 1, score: 90 },
    { seatId: "l3b-2", col: 2, score: 90 },
  ]);
  await insertSession({ id: "l3-noblock", startTime: "2099-06-25T19:00:00.000Z" });
  await insertSeats("l3-noblock", [
    { seatId: "l3nb-1", col: 1, score: 90 },
    { seatId: "l3nb-3", col: 3, score: 90 },
  ]);

  const body = await getTogether("chain=event&party=2&minScore=74");

  assertTogetherShape(body);
  assert.equal(body.count, 2);
  assert.equal(body.results.length, body.count);
  assert.deepEqual(resultIds(body).sort(), ["l3-block", "l3-noblock"]);
  const blockless = body.results.find((r) => r.session.id === "l3-noblock")!;
  assert.equal(blockless.block, null);
  // A real block outranks a blockless session.
  assert.equal(body.results[0]!.session.id, "l3-block");
});

test("L1.4 a movie/cinema/date with no session at all is simply absent (not a null row)", { skip: dbSkip }, async () => {
  await insertSession({ id: "l4-present", movieId: "M-present" });
  await insertSeats("l4-present", [
    { seatId: "l4-1", col: 1, score: 90 },
    { seatId: "l4-2", col: 2, score: 90 },
  ]);

  const body = await getTogether("chain=event&movieId=M-absent");

  assert.deepEqual(body, {
    party: 2,
    minScore: 74,
    count: 0,
    results: [],
    // P30.3 (C7): no watch + empty refresh_runs ledger in this suite -> not_cached, null instants.
    freshness: {
      oldestFetchedAt: null,
      newestFetchedAt: null,
      lastSuccessfulIngestAt: null,
      coverage: { event: "not_cached" },
    },
  });
});
