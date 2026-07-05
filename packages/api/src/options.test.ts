import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPool } from "@auscinema/ingester";
import { buildServer } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const hasDatabase = Boolean(databaseUrl);
const dbSkip = hasDatabase ? false : "DATABASE_URL is unset";
const schemaName = `p47a_api_${process.pid}`;

let schemaSql = "";
let adminPool: ReturnType<typeof createPool> | undefined;
let pool: ReturnType<typeof createPool> | undefined;

type Pool = ReturnType<typeof createPool>;

type OptionsResponse = {
  movieKey: string;
  movieTitle: string;
  party: number;
  minScore: number;
  count: number;
  options: Array<{
    chain: string;
    cinemaId: string;
    cinemaName: string;
    sessionId: string;
    startsAt: string;
    date: string;
    format: string;
    isLargeFormat: boolean;
    formatRank: 0 | 1 | 2;
    bestBlockScore: number | null;
    bestBlockSize: number | null;
    fitTier: "together" | "nearby" | "split";
    togetherCount: number;
    geometryConfidence: "exact" | "approximate";
    freshness: { asOf: string; state: "fresh" | "stale" };
    bookingUrl: string;
  }>;
  freshness: {
    oldestFetchedAt: string | null;
    newestFetchedAt: string | null;
    lastSuccessfulIngestAt: string | null;
    coverage: Record<string, string>;
  };
};

type CatalogResponse = {
  movies: unknown[];
  cinemas: unknown[];
  dates: string[];
  horizonDate: string;
  maxCachedDate: string | null;
  titles: Array<{ movieKey: string; chain: string; title: string; sessionCount: number }>;
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
    "refusing to run destructive #47a API tests against the live seatfinder database",
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
  await pool?.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`).catch(() => undefined);
    await adminPool.end();
  }
});

type SessionSeed = {
  id: string;
  chain?: string;
  movieId?: string;
  movieName?: string | null;
  cinemaId?: string;
  cinemaName?: string | null;
  date?: string;
  startTime?: string | null;
  format?: string | null;
  bookingUrl?: string | null;
  seatAllocation?: boolean | null;
  fetchedAt?: string;
  disappearedAt?: string | null;
};

async function insertSession(overrides: SessionSeed): Promise<void> {
  const s = {
    chain: "event",
    movieId: "555",
    movieName: "Dune: Part Two",
    cinemaId: "C1",
    cinemaName: "Test Cinema",
    date: "2099-07-21",
    startTime: "2099-07-21T19:30:00.000Z",
    format: "standard",
    bookingUrl: `https://example.test/book?sid=${overrides.id}`,
    seatAllocation: true,
    fetchedAt: "2099-07-21T02:00:00.000Z",
    disappearedAt: null as string | null,
    ...overrides,
  };
  await requirePool().query(
    `INSERT INTO sessions
       (id, chain, movie_id, movie_name, cinema_id, cinema_name, date, start_time,
        format, screen, seats_available, booking_url, seat_allocation, fetched_at, disappeared_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,$10,$11,$12,$13)`,
    [
      s.id,
      s.chain,
      s.movieId,
      s.movieName,
      s.cinemaId,
      s.cinemaName,
      s.date,
      s.startTime,
      s.format,
      s.bookingUrl,
      s.seatAllocation,
      s.fetchedAt,
      s.disappearedAt,
    ],
  );
}

type SeatSeed = { seatId: string; row?: number; col: number; score: number; rowLabel?: string };

async function insertSeats(sessionId: string, seats: readonly SeatSeed[]): Promise<void> {
  for (const seat of seats) {
    await requirePool().query(
      `INSERT INTO session_seats (session_id, seat_id, row_label, row, col, area_kind, score)
       VALUES ($1, $2, $3, $4, $5, 'standard', $6)`,
      [sessionId, seat.seatId, seat.rowLabel ?? "A", seat.row ?? 1, seat.col, seat.score],
    );
  }
}

async function getOptions(query: string): Promise<{ status: number; body: unknown }> {
  const server = buildServer({ pool: requirePool(), rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: `/options?${query}` });
  return { status: res.statusCode, body: res.json() };
}

async function getCatalog(query = ""): Promise<CatalogResponse> {
  const server = buildServer({ pool: requirePool(), rateLimit: false, logger: false });
  const suffix = query.length > 0 ? `?${query}` : "";
  const res = await server.inject({ method: "GET", url: `/catalog${suffix}` });
  assert.equal(res.statusCode, 200);
  return res.json() as CatalogResponse;
}

// --- §1.7 errors (no pool needed for these) ---------------------------------------------------

test("/options missing movieKey -> 400 {error}", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: "/options" });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: "missing required query param: movieKey" });
});

test("/options malformed movieKey (no colon) -> 400", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: "/options?movieKey=event555" });
  assert.equal(res.statusCode, 400);
});

test("/options malformed movieKey (empty chain) -> 400", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: "/options?movieKey=:555" });
  assert.equal(res.statusCode, 400);
});

test("/options malformed movieKey (empty id) -> 400", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: "/options?movieKey=event:" });
  assert.equal(res.statusCode, 400);
});

test("/options unknown chain in movieKey -> 400", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: "/options?movieKey=amc:555" });
  assert.equal(res.statusCode, 400);
});

test("/options chain param mismatched with movieKey's chain -> 400", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({
    method: "GET",
    url: "/options?movieKey=event:555&chain=hoyts",
  });
  assert.equal(res.statusCode, 400);
});

test("/options chain param matching movieKey's chain is accepted (no pool -> 503, not 400)", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({
    method: "GET",
    url: "/options?movieKey=event:555&chain=event",
  });
  assert.equal(res.statusCode, 503);
});

test("/options with no pool configured -> 503 {error}", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: "/options?movieKey=event:555" });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { error: "database not configured" });
});

test("/options over rate limit -> 429 {error}", async () => {
  const server = buildServer({ rateLimit: { max: 1, windowMs: 60_000 }, logger: false });
  const first = await server.inject({ method: "GET", url: "/options?movieKey=event:555" });
  assert.equal(first.statusCode, 503); // no pool, but under the limit
  const second = await server.inject({ method: "GET", url: "/options?movieKey=event:555" });
  assert.equal(second.statusCode, 429);
  assert.deepEqual(second.json(), { error: "rate limit exceeded" });
});

// --- #47a contract §6 integration fixture (party=3, minScore=74) -----------------------------
//
// CONTRACT ERRATUM (flagged in PR #69): §6's worked JSON example shows one response for
// movieKey "event:555" containing options from THREE chains (event, village, hoyts). That
// example contradicts the contract's normative sections three times over:
//   - §1.1: `chain` is derived from movieKey; a caller cannot ask for a movie under a different
//     chain than its key.
//   - §3: "No cross-chain merge. ... two different movieKeys, two different /options calls if
//     the user picks both."
//   - §4: "No cross-chain movie identity resolution (#61 stays deferred)."
// The implementation follows the normative sections (one chain per /options call), so this test
// exercises the §6 fixture's exact three scenarios via three per-chain movieKey calls and asserts
// the union matches the fixture rows. Every §6 checklist bullet is still asserted.

test(
  "contract §6 fixture: together (event) / nearby (village) / split (hoyts) all present and correct",
  { skip: dbSkip },
  async () => {
    // Per-card freshness is computed against the real clock (fetched_at age vs the 2h default
    // threshold), so seed fetched_at relative to now: village 3h ago -> stale, others 10min -> fresh.
    const fetchedFresh = new Date(Date.now() - 10 * 60_000).toISOString();
    const fetchedStale = new Date(Date.now() - 3 * 60 * 60_000).toISOString();

    // Session A: Event, together, avgScore 91, IMAX.
    await insertSession({
      id: "evt-9001",
      chain: "event",
      cinemaId: "12",
      cinemaName: "Event George St",
      format: "IMAX",
      fetchedAt: fetchedFresh,
    });
    await insertSeats("evt-9001", [
      { seatId: "e1", col: 1, score: 90 },
      { seatId: "e2", col: 2, score: 91 },
      { seatId: "e3", col: 3, score: 92 },
    ]);

    // Session B: Hoyts, split, togetherCount=2 (two isolated in-zone seats, not adjacent).
    await insertSession({
      id: "hoy-2207",
      chain: "hoyts",
      cinemaId: "88",
      cinemaName: "Hoyts EQ",
      format: "",
      fetchedAt: fetchedFresh,
    });
    await insertSeats("hoy-2207", [
      { seatId: "h1", row: 1, col: 1, score: 90 },
      { seatId: "h2", row: 2, col: 5, score: 85 },
    ]);

    // Session C: Village, nearby, run of exactly 2 (not 3), Vmax, stale (fetched >2h ago).
    await insertSession({
      id: "vil-4410",
      chain: "village",
      cinemaId: "40",
      cinemaName: "Village Crown",
      format: "Vmax",
      fetchedAt: fetchedStale,
    });
    await insertSeats("vil-4410", [
      { seatId: "v1", col: 1, score: 78 },
      { seatId: "v2", col: 2, score: 78 },
    ]);

    // One /options call per chain's movieKey (per §1.1/§3 — see erratum note above).
    const responses = new Map<string, OptionsResponse>();
    for (const chain of ["event", "hoyts", "village"] as const) {
      const { status, body } = await getOptions(`movieKey=${chain}:555&party=3&minScore=74`);
      assert.equal(status, 200);
      const res = body as OptionsResponse;
      assert.equal(res.movieKey, `${chain}:555`);
      assert.equal(res.party, 3);
      assert.equal(res.minScore, 74);
      // Checklist: count equals options.length. Single-chain per call, so 1 row each.
      assert.equal(res.count, res.options.length);
      assert.equal(res.count, 1);
      assert.equal(res.options[0]!.chain, chain);
      assert.equal(res.movieTitle, "Dune: Part Two");
      responses.set(chain, res);
    }

    const event = responses.get("event")!.options[0]!;
    const village = responses.get("village")!.options[0]!;
    const hoyts = responses.get("hoyts")!.options[0]!;
    const allRows = [event, village, hoyts];

    // Checklist: together/nearby/split all present and matching §1.5's specific algorithm.
    assert.equal(event.fitTier, "together");
    assert.equal(event.togetherCount, 3);
    assert.equal(event.bestBlockScore, 91);
    assert.equal(event.bestBlockSize, 3);
    assert.equal(event.geometryConfidence, "exact");
    assert.equal(event.formatRank, 2);
    assert.equal(event.isLargeFormat, true);
    assert.equal(event.freshness.state, "fresh");

    assert.equal(village.fitTier, "nearby");
    assert.equal(village.togetherCount, 2);
    assert.equal(village.bestBlockScore, 78);
    assert.equal(village.bestBlockSize, 2);
    assert.equal(village.formatRank, 1);
    assert.equal(village.isLargeFormat, true);
    // Checklist: per-card freshness differs across cards — the village row is individually stale
    // while the event/hoyts rows are fresh, independent of any top-level aggregate implication.
    assert.equal(village.freshness.state, "stale");

    assert.equal(hoyts.fitTier, "split");
    assert.equal(hoyts.togetherCount, 2);
    assert.equal(hoyts.bestBlockScore, null);
    assert.equal(hoyts.bestBlockSize, null);
    assert.equal(hoyts.formatRank, 0);
    assert.equal(hoyts.isLargeFormat, false);
    assert.equal(hoyts.freshness.state, "fresh");

    // Checklist: hoyts row is the only "approximate"; all others "exact".
    for (const o of allRows) {
      assert.equal(o.geometryConfidence, o.chain === "hoyts" ? "approximate" : "exact");
    }
    // Checklist: cinemaName non-empty on every row.
    for (const o of allRows) assert.notEqual(o.cinemaName, "");
  },
);

test("default order (most together) ranks together > nearby > split, then togetherCount, then bestBlockScore, then startsAt", { skip: dbSkip }, async () => {
  await insertSession({ id: "s-split", startTime: "2099-07-21T10:00:00.000Z", fetchedAt: "2099-07-21T09:00:00.000Z" });
  await insertSeats("s-split", [{ seatId: "sp1", col: 1, score: 90 }]);

  await insertSession({ id: "s-nearby", startTime: "2099-07-21T12:00:00.000Z", fetchedAt: "2099-07-21T09:00:00.000Z" });
  await insertSeats("s-nearby", [
    { seatId: "n1", col: 1, score: 80 },
    { seatId: "n2", col: 2, score: 80 },
  ]);

  await insertSession({ id: "s-together-late", startTime: "2099-07-21T20:00:00.000Z", fetchedAt: "2099-07-21T09:00:00.000Z" });
  await insertSeats("s-together-late", [
    { seatId: "t1", col: 1, score: 90 },
    { seatId: "t2", col: 2, score: 90 },
  ]);

  await insertSession({ id: "s-together-early", startTime: "2099-07-21T08:00:00.000Z", fetchedAt: "2099-07-21T09:00:00.000Z" });
  await insertSeats("s-together-early", [
    { seatId: "t3", col: 1, score: 90 },
    { seatId: "t4", col: 2, score: 90 },
  ]);

  const { status, body } = await getOptions("movieKey=event:555&party=2&minScore=74");
  assert.equal(status, 200);
  const res = body as OptionsResponse;
  assert.deepEqual(
    res.options.map((o) => o.sessionId),
    ["s-together-early", "s-together-late", "s-nearby", "s-split"],
  );
});

test("cinemaName #67 fallback: blank pre-fix row self-heals from another cached row for the same cinema", { skip: dbSkip }, async () => {
  await insertSession({
    id: "hoy-backfilled",
    chain: "hoyts",
    cinemaId: "88",
    cinemaName: "Hoyts EQ", // already backfilled by a post-#67-fix ingest
    movieId: "other-movie",
    fetchedAt: "2099-07-21T01:00:00.000Z",
  });
  await insertSession({
    id: "hoy-still-blank",
    chain: "hoyts",
    cinemaId: "88",
    cinemaName: "", // pre-#67-fix cached row, not yet re-ingested
    movieId: "555",
    fetchedAt: "2099-07-21T01:00:00.000Z",
  });
  await insertSeats("hoy-still-blank", [{ seatId: "b1", col: 1, score: 90 }]);

  const { status, body } = await getOptions("movieKey=hoyts:555&party=2&minScore=74");
  assert.equal(status, 200);
  const res = body as OptionsResponse;
  assert.equal(res.options.length, 1);
  assert.equal(res.options[0]!.cinemaName, "Hoyts EQ");
});

test("cinemaName stays blank when no cached row anywhere has a name for that cinema (known transitional gap)", { skip: dbSkip }, async () => {
  await insertSession({
    id: "hoy-cold",
    chain: "hoyts",
    cinemaId: "99",
    cinemaName: "",
    movieId: "555",
    fetchedAt: "2099-07-21T01:00:00.000Z",
  });
  await insertSeats("hoy-cold", [{ seatId: "c1", col: 1, score: 90 }]);

  const { body } = await getOptions("movieKey=hoyts:555&party=2&minScore=74");
  const res = body as OptionsResponse;
  assert.equal(res.options[0]!.cinemaName, "");
});

test("liveness: tombstoned and past-date sessions are excluded (mirrors /together)", { skip: dbSkip }, async () => {
  await insertSession({ id: "live-one" });
  await insertSeats("live-one", [{ seatId: "l1", col: 1, score: 90 }]);
  await insertSession({ id: "tombstoned", disappearedAt: "2099-07-20T00:00:00.000Z" });
  await insertSession({ id: "past-date", date: "2020-01-01", startTime: "2020-01-01T19:30:00.000Z" });

  const { body } = await getOptions("movieKey=event:555&party=2&minScore=74");
  const res = body as OptionsResponse;
  assert.deepEqual(
    res.options.map((o) => o.sessionId),
    ["live-one"],
  );
});

test("empty cache for a movieKey -> count 0, empty options, movieTitle still resolved from any cached row", { skip: dbSkip }, async () => {
  await insertSession({ id: "past-only", date: "2020-01-01", startTime: "2020-01-01T19:30:00.000Z" });

  const { body } = await getOptions("movieKey=event:555&party=2&minScore=74");
  const res = body as OptionsResponse;
  assert.equal(res.count, 0);
  assert.deepEqual(res.options, []);
  assert.equal(res.movieTitle, "Dune: Part Two");
});

// --- §1.4 classifyFormat wired end-to-end ------------------------------------------------------

test("formatRank/isLargeFormat match §1.4 classifier for IMAX, Vmax, and empty string", { skip: dbSkip }, async () => {
  await insertSession({ id: "fmt-imax", format: "IMAX" });
  await insertSeats("fmt-imax", [{ seatId: "f1", col: 1, score: 90 }]);
  await insertSession({ id: "fmt-vmax", format: "Vmax", cinemaId: "C2" });
  await insertSeats("fmt-vmax", [{ seatId: "f2", col: 1, score: 90 }]);
  await insertSession({ id: "fmt-blank", format: "", cinemaId: "C3" });
  await insertSeats("fmt-blank", [{ seatId: "f3", col: 1, score: 90 }]);

  const { body } = await getOptions("movieKey=event:555&party=1&minScore=74");
  const res = body as OptionsResponse;
  const byId = new Map(res.options.map((o) => [o.sessionId, o]));
  assert.deepEqual([byId.get("fmt-imax")!.formatRank, byId.get("fmt-imax")!.isLargeFormat], [2, true]);
  assert.deepEqual([byId.get("fmt-vmax")!.formatRank, byId.get("fmt-vmax")!.isLargeFormat], [1, true]);
  assert.deepEqual([byId.get("fmt-blank")!.formatRank, byId.get("fmt-blank")!.isLargeFormat], [0, false]);
});

// --- §2 /catalog `titles` extension ------------------------------------------------------------

test("/catalog titles only lists movies with sessionCount > 0 (liveness-filtered)", { skip: dbSkip }, async () => {
  await insertSession({ id: "cat-live", movieId: "555", movieName: "Dune: Part Two" });
  await insertSession({
    id: "cat-tombstoned",
    movieId: "666",
    movieName: "Gone",
    disappearedAt: "2099-07-20T00:00:00.000Z",
  });
  await insertSession({
    id: "cat-past",
    movieId: "777",
    movieName: "Old News",
    date: "2020-01-01",
    startTime: "2020-01-01T19:30:00.000Z",
  });

  const catalog = await getCatalog();
  const keys = catalog.titles.map((t) => t.movieKey);
  assert.ok(keys.includes("event:555"));
  assert.ok(!keys.includes("event:666"));
  assert.ok(!keys.includes("event:777"));

  const dune = catalog.titles.find((t) => t.movieKey === "event:555")!;
  assert.equal(dune.chain, "event");
  assert.equal(dune.title, "Dune: Part Two");
  assert.equal(dune.sessionCount, 1);
});

test("/catalog titles sessionCount aggregates multiple live sessions for the same movieKey", { skip: dbSkip }, async () => {
  await insertSession({ id: "cat-a", movieId: "555", movieName: "Dune: Part Two" });
  await insertSession({ id: "cat-b", movieId: "555", movieName: "Dune: Part Two", cinemaId: "C2" });

  const catalog = await getCatalog();
  const dune = catalog.titles.find((t) => t.movieKey === "event:555")!;
  assert.equal(dune.sessionCount, 2);
});
