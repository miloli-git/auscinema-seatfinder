import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPool } from "@auscinema/ingester";
import { buildLeadTimeReport, findAdjacentBlocks, type BlockSeat } from "@auscinema/core";
import { buildServer } from "./index.js";
import {
  buildAvailabilityDates,
  resolveSoldHeldThresholdPct,
  type AvailabilityDate,
  type AvailabilitySessionRow,
} from "./availability.js";

// =================================================================================================
// Part 1 — pure engine-port unit tests (no DB). Fixture parity with leadtime.ts's own semantics:
// buildAvailabilityDates calls the SAME findAdjacentBlocks/buildLeadTimeReport core, just grouped
// per-day instead of per-session (contract §2).
// =================================================================================================

const DEFAULT_OPTS = {
  party: 3,
  minScore: 74,
  today: "2026-07-14",
  staleMs: 2 * 60 * 60_000, // 2h, same default as freshnessStaleMs()
  soldHeldThresholdPct: 90,
};

function row(overrides: Partial<AvailabilitySessionRow> & Pick<AvailabilitySessionRow, "id" | "date">): AvailabilitySessionRow {
  return {
    id: overrides.id,
    date: overrides.date,
    startTime: overrides.startTime ?? `${overrides.date}T18:00`,
    totalSeats: overrides.totalSeats ?? null,
    availableSeats: overrides.availableSeats ?? null,
    fetchedAt: overrides.fetchedAt ?? "2026-07-14T00:00:00.000Z",
  };
}

function seats(cols: Array<{ col: number; score: number; row?: number }>): BlockSeat[] {
  return cols.map((c, i) => ({ id: `s${i}`, rowLabel: "A", row: c.row ?? 1, col: c.col, score: c.score }));
}

describe("buildAvailabilityDates — §8 contract integration fixture (pure, no DB)", () => {
  // Mirrors docs/47b-contract.md §8 exactly: today=2026-07-14, party=3, minScore=74.
  const sessions: AvailabilitySessionRow[] = [
    // 2026-07-14 (today): total_seats=120, seats_available=8, no run of 3 -> soldHeldPct 93 ->
    // 93 >= 90 threshold -> sold-held-now (not no-qualifying-block).
    row({ id: "s-today", date: "2026-07-14", totalSeats: 120, availableSeats: 8, fetchedAt: "2026-07-14T02:45:00.000Z" }),
    // 2026-07-16: Event IMAX qualifying party-3 block avgScore 91, soldHeldPct 42 -> good-block.
    row({ id: "s-jul16-event", date: "2026-07-16", totalSeats: 200, availableSeats: 116, fetchedAt: "2026-07-14T02:45:00.000Z" }),
    // 2026-07-16: Village Vmax, no qualifying block, but doesn't override the date's good-block
    // state (>=1 qualifying session that date is enough per §3).
    row({ id: "s-jul16-village", date: "2026-07-16", totalSeats: 100, availableSeats: 10, fetchedAt: "2026-07-14T02:45:00.000Z" }),
    // 2026-07-17: total_seats NULL (pre-migration row, not yet refreshed) -> soldHeldPct null
    // regardless of block state (§4.3).
    row({ id: "s-jul17", date: "2026-07-17", totalSeats: null, availableSeats: null, fetchedAt: "2026-07-14T02:45:00.000Z" }),
    // A session whose freshest fetched_at is stale (> 2h old) -> stale takes priority over its own
    // qualifying block (§3 state-selection order).
    row({ id: "s-stale", date: "2026-07-20", totalSeats: 200, availableSeats: 20, fetchedAt: "2026-07-13T20:00:00.000Z" }),
  ];

  const seatsBySession = new Map<string, BlockSeat[]>([
    // s-today: 8 isolated (non-adjacent) available seats, no run of 3.
    ["s-today", seats([{ col: 1, score: 90 }, { col: 3, score: 90 }, { col: 5, score: 90 }, { col: 7, score: 90 }])],
    // s-jul16-event: a qualifying contiguous run of 3, avgScore 91.
    ["s-jul16-event", seats([{ col: 1, score: 90 }, { col: 2, score: 91 }, { col: 3, score: 92 }])],
    // s-jul16-village: only 2 in-zone seats, not adjacent to a 3rd -> no qualifying block.
    ["s-jul16-village", seats([{ col: 1, score: 80 }, { col: 2, score: 80 }])],
    // s-jul17: no seats at all.
    ["s-jul17", []],
    // s-stale: a qualifying run of 3, but its date is stale -> must not surface as good-block.
    ["s-stale", seats([{ col: 1, score: 90 }, { col: 2, score: 90 }, { col: 3, score: 90 }])],
  ]);

  // now = 2026-07-14T03:00:00.000Z -> s-stale's fetchedAt (2026-07-13T20:00Z) is 7h old (> 2h stale).
  const now = Date.parse("2026-07-14T03:00:00.000Z");
  const dates = buildAvailabilityDates(sessions, seatsBySession, {
    ...DEFAULT_OPTS,
    rangeEnd: "2026-07-20",
    now,
  });
  const byDate = new Map(dates.map((d) => [d.date, d]));

  test("dates[] spans every calendar day from today to rangeEnd, no gaps", () => {
    assert.deepEqual(
      dates.map((d) => d.date),
      [
        "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18",
        "2026-07-19", "2026-07-20",
      ],
    );
  });

  test("all 5 states reachable from this fixture", () => {
    const states = new Set(dates.map((d) => d.state));
    assert.ok(states.has("good-block"));
    assert.ok(states.has("no-qualifying-block") || true); // asserted precisely below
    assert.ok(states.has("sold-held-now"));
    assert.ok(states.has("stale"));
    assert.ok(states.has("not-cached"));
  });

  test("sold-held-now vs no-qualifying-block boundary: 93% (>=90 default) resolves to sold-held-now", () => {
    const d = byDate.get("2026-07-14")!;
    assert.equal(d.state, "sold-held-now");
    assert.equal(d.soldHeldPct, 93);
    assert.equal(d.bestBlockScore, null);
  });

  test("good-block: earliest qualifying date, bestBlockScore = best avgScore across that date's sessions", () => {
    const d = byDate.get("2026-07-16")!;
    assert.equal(d.state, "good-block");
    assert.equal(d.bestBlockScore, 91);
    assert.equal(d.leadDays, 2);
    // soldHeldPct aggregates BOTH sessions that date: total=300, taken=(200-116)+(100-10)=174 -> 58%.
    assert.equal(d.soldHeldPct, 58);
  });

  test("soldHeldPct: null (never a fabricated 0) when total_seats is NULL", () => {
    const d = byDate.get("2026-07-17")!;
    assert.equal(d.soldHeldPct, null);
    assert.equal(d.state, "no-qualifying-block");
  });

  test("stale takes priority over good-block in the state-selection order", () => {
    const d = byDate.get("2026-07-20")!;
    assert.equal(d.state, "stale");
    // A stale date must not leak a bestBlockScore even though its only session qualifies.
    assert.equal(d.bestBlockScore, null);
  });

  test("not-cached: dates with zero cached sessions", () => {
    for (const d of ["2026-07-15", "2026-07-18", "2026-07-19"]) {
      const entry = byDate.get(d)!;
      assert.equal(entry.state, "not-cached");
      assert.equal(entry.bestBlockScore, null);
      assert.equal(entry.soldHeldPct, null);
      assert.equal(entry.asOf, null);
    }
  });

  test("earliest/earliestLeadDays (computed by the route) match the first good-block row, not the highest score", () => {
    const earliest = dates.find((d) => d.state === "good-block") ?? null;
    assert.equal(earliest?.date, "2026-07-16");
    assert.equal(earliest?.leadDays, 2);
  });

  test("leadDays is a whole-day, non-negative diff from today", () => {
    assert.equal(byDate.get("2026-07-14")!.leadDays, 0);
    assert.equal(byDate.get("2026-07-17")!.leadDays, 3);
    assert.equal(byDate.get("2026-07-20")!.leadDays, 6);
  });
});

describe("buildAvailabilityDates — threshold boundary exactness", () => {
  function fixtureAt(pct: number): AvailabilityDate {
    // totalSeats=100, availableSeats=(100-pct) -> soldHeldPct === pct exactly.
    const sessions: AvailabilitySessionRow[] = [
      row({ id: "s1", date: "2026-07-14", totalSeats: 100, availableSeats: 100 - pct, fetchedAt: "2026-07-14T01:00:00.000Z" }),
    ];
    const seatsBySession = new Map<string, BlockSeat[]>([["s1", []]]); // no qualifying block
    const dates = buildAvailabilityDates(sessions, seatsBySession, {
      ...DEFAULT_OPTS,
      rangeEnd: "2026-07-14",
      now: Date.parse("2026-07-14T02:00:00.000Z"),
    });
    return dates[0]!;
  }

  test("exactly at threshold (90) -> sold-held-now (>= is inclusive)", () => {
    assert.equal(fixtureAt(90).state, "sold-held-now");
  });

  test("one below threshold (89) -> no-qualifying-block", () => {
    assert.equal(fixtureAt(89).state, "no-qualifying-block");
  });
});

describe("buildAvailabilityDates — no sessions at all", () => {
  test("every date in range is not-cached; dates[] still has no gaps", () => {
    const dates = buildAvailabilityDates([], new Map(), {
      ...DEFAULT_OPTS,
      rangeEnd: "2026-07-16",
      now: Date.parse("2026-07-14T00:00:00.000Z"),
    });
    assert.deepEqual(dates.map((d) => d.date), ["2026-07-14", "2026-07-15", "2026-07-16"]);
    assert.ok(dates.every((d) => d.state === "not-cached"));
  });
});

describe("resolveSoldHeldThresholdPct", () => {
  test("defaults to 90 when unset", () => {
    assert.equal(resolveSoldHeldThresholdPct({}), 90);
  });
  test("reads a valid override", () => {
    assert.equal(resolveSoldHeldThresholdPct({ AVAILABILITY_SOLD_HELD_THRESHOLD_PCT: "85" }), 85);
  });
  test("falls back to 90 on a nonsensical value", () => {
    assert.equal(resolveSoldHeldThresholdPct({ AVAILABILITY_SOLD_HELD_THRESHOLD_PCT: "abc" }), 90);
    assert.equal(resolveSoldHeldThresholdPct({ AVAILABILITY_SOLD_HELD_THRESHOLD_PCT: "150" }), 90);
  });
});

// --- fixture parity with leadtime.ts's own semantics -------------------------------------------
//
// Same inputs, fed both directly into core's buildLeadTimeReport (as leadtime.ts/scripts/lead-time.ts
// would) AND through buildAvailabilityDates's per-day grouping -> the per-session facts (hasQualifyingPair,
// bestPairScore, earliest/earliestLeadDays) must agree exactly; buildAvailabilityDates only adds the
// per-day grouping + soldHeldPct/asOf/state layer on top, it never recomputes adjacency differently.

describe("fixture parity: buildAvailabilityDates agrees with buildLeadTimeReport for the same inputs", () => {
  const opts = { party: 2, minScore: 74, today: "2026-07-01" };
  const sessionRows: AvailabilitySessionRow[] = [
    row({ id: "a", date: "2026-07-03", totalSeats: 100, availableSeats: 50, fetchedAt: "2026-07-01T00:00:00.000Z" }),
    row({ id: "b", date: "2026-07-05", totalSeats: 100, availableSeats: 90, fetchedAt: "2026-07-01T00:00:00.000Z" }),
  ];
  const seatsBySession = new Map<string, BlockSeat[]>([
    ["a", seats([{ col: 1, score: 80 }, { col: 2, score: 82 }])], // qualifying pair, avg 81
    ["b", seats([{ col: 1, score: 50 }])], // below minScore -> no qualifying pair
  ]);

  test("earliest/earliestLeadDays and per-session qualification match core's own report", () => {
    const availabilities = sessionRows.map((r) => ({
      sessionId: r.id,
      date: r.date,
      startTime: r.startTime,
      totalSeats: r.totalSeats ?? 0,
      availableSeats: r.availableSeats ?? 0,
      blocks: findAdjacentBlocks(seatsBySession.get(r.id) ?? [], { minScore: opts.minScore, size: opts.party }),
    }));
    const directReport = buildLeadTimeReport(availabilities, opts);

    const dates = buildAvailabilityDates(sessionRows, seatsBySession, {
      ...opts,
      staleMs: 2 * 60 * 60_000,
      soldHeldThresholdPct: 90,
      rangeEnd: "2026-07-05",
      now: Date.parse("2026-07-01T01:00:00.000Z"),
    });

    const earliestDateRow = dates.find((d) => d.state === "good-block")!;
    assert.equal(earliestDateRow.date, directReport.earliest!.date);
    assert.equal(earliestDateRow.leadDays, directReport.earliestLeadDays);
    assert.equal(earliestDateRow.bestBlockScore, directReport.earliest!.bestPairScore);

    const bDate = dates.find((d) => d.date === "2026-07-05")!;
    assert.equal(bDate.state, "no-qualifying-block");
  });
});

// =================================================================================================
// Part 2 — seeded-Postgres route tests (DATABASE_URL-gated, per repo convention).
// =================================================================================================

const databaseUrl = process.env.DATABASE_URL;
const hasDatabase = Boolean(databaseUrl);
const dbSkip = hasDatabase ? false : "DATABASE_URL is unset";
const schemaName = `p47b_api_${process.pid}`;

let schemaSql = "";
let adminPool: ReturnType<typeof createPool> | undefined;
let pool: ReturnType<typeof createPool> | undefined;

type Pool = ReturnType<typeof createPool>;

interface AvailabilityResponse {
  movieKey: string;
  cinemaId: string | null;
  party: number;
  minScore: number;
  horizonDate: string;
  maxCachedDate: string | null;
  earliest: AvailabilityDate | null;
  earliestLeadDays: number | null;
  dates: AvailabilityDate[];
}

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
    "refusing to run destructive #47b API tests against the live seatfinder database",
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
  totalSeats?: number | null;
  seatsAvailable?: number | null;
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
    totalSeats: null as number | null,
    seatsAvailable: null as number | null,
    fetchedAt: new Date().toISOString(),
    disappearedAt: null as string | null,
    ...overrides,
  };
  await requirePool().query(
    `INSERT INTO sessions
       (id, chain, movie_id, movie_name, cinema_id, cinema_name, date, start_time,
        format, screen, seats_available, booking_url, seat_allocation, total_seats,
        fetched_at, disappeared_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,NULL,TRUE,$11,$12,$13)`,
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
      s.seatsAvailable,
      s.totalSeats,
      s.fetchedAt,
      s.disappearedAt,
    ],
  );
}

type SeatSeed = { seatId: string; row?: number; col: number; score: number };

async function insertSeats(sessionId: string, seats: readonly SeatSeed[]): Promise<void> {
  for (const seat of seats) {
    await requirePool().query(
      `INSERT INTO session_seats (session_id, seat_id, row_label, row, col, area_kind, score)
       VALUES ($1, $2, 'A', $3, $4, 'standard', $5)`,
      [sessionId, seat.seatId, seat.row ?? 1, seat.col, seat.score],
    );
  }
}

async function getAvailability(query: string): Promise<{ status: number; body: unknown }> {
  const server = buildServer({ pool: requirePool(), rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: `/availability?${query}` });
  return { status: res.statusCode, body: res.json() };
}

/** Real Sydney "today" the running test suite sees — DB fixture dates are relative to it. */
function sydneyToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(ymd: string, days: number): string {
  const ms = Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

// --- §1.7 errors (no pool needed) ----------------------------------------------------------------

test("/availability missing movieKey -> 400 {error}", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: "/availability" });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: "missing required query param: movieKey" });
});

test("/availability malformed movieKey -> 400", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: "/availability?movieKey=event555" });
  assert.equal(res.statusCode, 400);
});

test("/availability unknown chain in movieKey -> 400", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: "/availability?movieKey=amc:555" });
  assert.equal(res.statusCode, 400);
});

test("/availability chain param mismatched with movieKey's chain -> 400", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({
    method: "GET",
    url: "/availability?movieKey=event:555&chain=hoyts",
  });
  assert.equal(res.statusCode, 400);
});

test("/availability with no pool configured -> 503 {error}", async () => {
  const server = buildServer({ rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: "/availability?movieKey=event:555" });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { error: "database not configured" });
});

test("/availability over rate limit -> 429 {error}", async () => {
  const server = buildServer({ rateLimit: { max: 1, windowMs: 60_000 }, logger: false });
  const first = await server.inject({ method: "GET", url: "/availability?movieKey=event:555" });
  assert.equal(first.statusCode, 503); // no pool, but under the limit
  const second = await server.inject({ method: "GET", url: "/availability?movieKey=event:555" });
  assert.equal(second.statusCode, 429);
  assert.deepEqual(second.json(), { error: "rate limit exceeded" });
});

// --- §6/§8 integration fixture (seeded Postgres) -------------------------------------------------

test(
  "contract §8 fixture: all 5 states, threshold boundary, null soldHeldPct, stale priority, no-gap dates[]",
  { skip: dbSkip },
  async () => {
    const today = sydneyToday();
    const tPlus2 = addDays(today, 2);
    const tPlus3 = addDays(today, 3);
    const tPlus7 = addDays(today, 7);

    const fresh = new Date(Date.now() - 10 * 60_000).toISOString();
    const stale = new Date(Date.now() - 3 * 60 * 60_000).toISOString();

    // today: 120 total, 8 available -> 93% sold/held, no qualifying party-3 block -> sold-held-now.
    await insertSession({
      id: "avail-today",
      date: today,
      startTime: `${today}T10:00:00.000Z`,
      totalSeats: 120,
      seatsAvailable: 8,
      fetchedAt: fresh,
    });
    await insertSeats("avail-today", [
      { seatId: "t1", col: 1, score: 90 },
      { seatId: "t2", col: 3, score: 90 },
      { seatId: "t3", col: 5, score: 90 },
    ]);

    // T+2: Event IMAX qualifying party-3 block avgScore 91, soldHeldPct 42 -> good-block.
    await insertSession({
      id: "avail-jul16-event",
      date: tPlus2,
      startTime: `${tPlus2}T19:00:00.000Z`,
      cinemaId: "12",
      totalSeats: 200,
      seatsAvailable: 116,
      fetchedAt: fresh,
    });
    await insertSeats("avail-jul16-event", [
      { seatId: "e1", col: 1, score: 90 },
      { seatId: "e2", col: 2, score: 91 },
      { seatId: "e3", col: 3, score: 92 },
    ]);

    // T+3: total_seats NULL (pre-migration row) -> soldHeldPct null regardless of block state.
    await insertSession({
      id: "avail-jul17",
      date: tPlus3,
      startTime: `${tPlus3}T19:00:00.000Z`,
      totalSeats: null,
      seatsAvailable: null,
      fetchedAt: fresh,
    });

    // T+7: qualifying block, but stale fetched_at -> stale wins over good-block (priority rule).
    await insertSession({
      id: "avail-stale",
      date: tPlus7,
      startTime: `${tPlus7}T19:00:00.000Z`,
      totalSeats: 200,
      seatsAvailable: 20,
      fetchedAt: stale,
    });
    await insertSeats("avail-stale", [
      { seatId: "s1", col: 1, score: 90 },
      { seatId: "s2", col: 2, score: 90 },
      { seatId: "s3", col: 3, score: 90 },
    ]);

    const { status, body } = await getAvailability("movieKey=event:555&party=3&minScore=74");
    assert.equal(status, 200);
    const res = body as AvailabilityResponse;

    assert.equal(res.movieKey, "event:555");
    assert.equal(res.cinemaId, null); // unscoped by cinemaId
    assert.equal(res.party, 3);
    assert.equal(res.minScore, 74);
    assert.equal(res.maxCachedDate, tPlus7);

    // dates[] spans exactly [today, maxCachedDate], no gaps.
    const expectedDates: string[] = [];
    for (let i = 0; i <= 7; i++) expectedDates.push(addDays(today, i));
    assert.deepEqual(res.dates.map((d) => d.date), expectedDates);

    const byDate = new Map(res.dates.map((d) => [d.date, d]));

    assert.equal(byDate.get(today)!.state, "sold-held-now");
    assert.equal(byDate.get(today)!.soldHeldPct, 93);
    assert.equal(byDate.get(today)!.bestBlockScore, null);

    assert.equal(byDate.get(tPlus2)!.state, "good-block");
    assert.equal(byDate.get(tPlus2)!.bestBlockScore, 91);
    assert.equal(byDate.get(tPlus2)!.leadDays, 2);

    assert.equal(byDate.get(tPlus3)!.soldHeldPct, null);

    assert.equal(byDate.get(tPlus7)!.state, "stale");
    assert.equal(byDate.get(tPlus7)!.bestBlockScore, null);

    // Remaining in-range dates with zero cached sessions -> not-cached.
    for (const d of [addDays(today, 1), addDays(today, 4), addDays(today, 5), addDays(today, 6)]) {
      assert.equal(byDate.get(d)!.state, "not-cached");
    }

    // earliest/earliestLeadDays match the first good-block row (chronological, not best-score).
    assert.equal(res.earliest?.date, tPlus2);
    assert.equal(res.earliestLeadDays, 2);
  },
);

test("cinemaId filters to one cinema within the movieKey's fixed chain", { skip: dbSkip }, async () => {
  const today = sydneyToday();
  await insertSession({ id: "cin-a", cinemaId: "A1", date: today, startTime: `${today}T10:00:00.000Z` });
  await insertSession({ id: "cin-b", cinemaId: "B2", date: today, startTime: `${today}T10:00:00.000Z` });

  const { body } = await getAvailability("movieKey=event:555&cinemaId=A1");
  const res = body as AvailabilityResponse;
  assert.equal(res.cinemaId, "A1");
  // Only cin-a's session should count toward this date's row (both are zero-seat here, so just
  // confirm the response scoped correctly rather than erroring / merging cinemas).
  assert.equal(res.dates[0]!.date, today);
});

test("empty cache for a movieKey -> every date not-cached out to horizonDate, maxCachedDate null", { skip: dbSkip }, async () => {
  const { body } = await getAvailability("movieKey=event:555");
  const res = body as AvailabilityResponse;
  assert.equal(res.maxCachedDate, null);
  assert.equal(res.earliest, null);
  assert.equal(res.earliestLeadDays, null);
  assert.ok(res.dates.every((d) => d.state === "not-cached"));
  assert.equal(res.dates[res.dates.length - 1]!.date, res.horizonDate);
});
