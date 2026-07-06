import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Chain, ChainAdapter, Cinema, Seat, SeatMap, Session, SessionQuery } from "@auscinema/core";
import {
  createPool,
  runRefreshTick,
  selectDueSessions,
  tierForSessionDate,
  type AdapterRegistry,
  type WatchRow,
} from "./index.js";

type RefreshTier = ReturnType<typeof tierForSessionDate>;
type KnownSession = Parameters<typeof selectDueSessions>[0][number];
type SkipKey = { chain: string; tier: string; cinemaId: string; date: string };

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
    "refusing to run destructive refresh tests against the live seatfinder database",
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

function minutes(n: number): number {
  return n * 60_000;
}

function hours(n: number): number {
  return n * 60 * 60_000;
}

function beforeInstant(now: Date, ageMs: number): Date {
  return new Date(now.getTime() - ageMs);
}

function known(overrides: Partial<KnownSession> & { sessionId: string; tier: RefreshTier; fetchedAt: Date }): KnownSession {
  return {
    chain: "event",
    cinemaId: "C1",
    date: "2026-10-05",
    live: true,
    ...overrides,
  } as KnownSession;
}

function selectedIds(result: ReturnType<typeof selectDueSessions>): string[] {
  return [...result.selected];
}

function skippedAt(skipped: unknown, key: SkipKey): number {
  if (Array.isArray(skipped)) {
    const row = skipped.find((candidate) => {
      const r = candidate as Record<string, unknown>;
      return r.chain === key.chain && r.tier === key.tier && r.cinemaId === key.cinemaId && r.date === key.date;
    }) as Record<string, unknown> | undefined;
    return Number(row?.count ?? row?.dropped ?? row?.skipped ?? 0);
  }

  if (!skipped || typeof skipped !== "object") return 0;
  const record = skipped as Record<string, unknown>;
  const flatKeys = [
    `${key.chain}|${key.tier}|${key.cinemaId}|${key.date}`,
    `${key.chain}:${key.tier}:${key.cinemaId}:${key.date}`,
    JSON.stringify(key),
  ];
  for (const flatKey of flatKeys) {
    if (typeof record[flatKey] === "number") return Number(record[flatKey]);
  }

  const chain = record[key.chain] as Record<string, unknown> | undefined;
  const tier = chain?.[key.tier] as Record<string, unknown> | undefined;
  const cinema = tier?.[key.cinemaId] as Record<string, unknown> | undefined;
  if (typeof cinema?.[key.date] === "number") return Number(cinema[key.date]);
  const cinemaDate = tier?.[`${key.cinemaId}|${key.date}`];
  if (typeof cinemaDate === "number") return Number(cinemaDate);
  return 0;
}

function totalSkipped(skipped: unknown): number {
  if (typeof skipped === "number") return skipped;
  if (!skipped || typeof skipped !== "object") return 0;
  if (Array.isArray(skipped)) {
    return skipped.reduce((sum, row) => {
      const r = row as Record<string, unknown>;
      return sum + Number(r.count ?? r.dropped ?? r.skipped ?? 0);
    }, 0);
  }
  return Object.values(skipped as Record<string, unknown>).reduce<number>(
    (sum, value) => sum + totalSkipped(value),
    0,
  );
}

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
    geometryConfidence: "exact",
  };
}

class Deferred<T = void> {
  promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason?: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

function stubAdapter(
  chain: Chain,
  sessions: Session[],
  maps: Record<string, SeatMap | Error | (() => Promise<SeatMap>)>,
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
      if (typeof plan === "function") return plan();
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
  date?: string;
  fetchedAt: Date;
}): Promise<void> {
  const chain = args.chain ?? "event";
  const cinemaId = args.cinemaId ?? "C1";
  const date = args.date ?? "2026-10-05";
  await requirePool().query(
    `INSERT INTO sessions
       (id, watch_id, chain, movie_id, movie_name, cinema_id, cinema_name, date,
        start_time, format, screen, seats_available, booking_url, seat_allocation, fetched_at, last_seen)
     VALUES ($1,$2,$3,'M1','Test Movie',$4,$5,$6,$7,'STANDARD','3',42,$8,true,$9,$9)`,
    [
      args.id,
      args.watchId,
      chain,
      cinemaId,
      `Cinema ${cinemaId}`,
      date,
      `${date}T19:00:00.000Z`,
      `https://book.example/${args.id}`,
      args.fetchedAt,
    ],
  );
}

async function refreshRunRows(): Promise<
  {
    outcome: string;
    sessions_due: number | null;
    sessions_refreshed: number | null;
    sessions_skipped_budget: number | null;
    sessions_new: number | null;
    sessions_disappeared: number | null;
    errors: number | null;
    per_chain: unknown;
    per_tier: unknown;
    finished_at: Date | null;
  }[]
> {
  const { rows } = await requirePool().query(
    `SELECT outcome, sessions_due, sessions_refreshed, sessions_skipped_budget,
            sessions_new, sessions_disappeared, errors, per_chain, per_tier, finished_at
       FROM refresh_runs
      ORDER BY id`,
  );
  return rows;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  assert.ok(value && typeof value === "object");
  return value as Record<string, unknown>;
}

// --- Pure P30.1 contract tests ----------------------------------------------

test("C1 tierForSessionDate uses AU/Sydney calendar boundaries and never UTC-parses fake-Z wall time", () => {
  const lateSydney = new Date("2026-06-24T13:59:00.000Z"); // 2026-06-24 23:59 in Sydney.
  assert.equal(tierForSessionDate("2026-06-24T23:30:00.000Z", lateSydney), "T0");
  assert.equal(
    tierForSessionDate("2026-06-25T23:30:00.000Z", lateSydney),
    "T0",
    "late fake-Z tomorrow must stay tomorrow by substring, not become Sydney day+2 by UTC parse",
  );
  assert.equal(tierForSessionDate("2026-06-26T00:05:00.000Z", lateSydney), "T1");
  assert.equal(tierForSessionDate("2026-07-01T23:30:00.000Z", lateSydney), "T1");
  assert.equal(tierForSessionDate("2026-07-02T23:30:00.000Z", lateSydney), "T2");

  const justAfterMidnightSydney = new Date("2026-06-24T14:01:00.000Z"); // 2026-06-25 00:01 in Sydney.
  assert.equal(tierForSessionDate("2026-06-26T23:30:00.000Z", justAfterMidnightSydney), "T0");
  assert.equal(tierForSessionDate("2026-06-27T00:05:00.000Z", justAfterMidnightSydney), "T1");
});

test("C1 tierForSessionDate stays correct across the Sydney DST start boundary", () => {
  const beforeDstJump = new Date("2026-10-03T13:30:00.000Z"); // 2026-10-03 23:30 in Sydney.

  assert.equal(
    tierForSessionDate("2026-10-04T23:30:00.000Z", beforeDstJump),
    "T0",
    "fake-Z local Sunday night is tomorrow, even though UTC parsing would push it to Monday Sydney",
  );
  assert.equal(tierForSessionDate("2026-10-05T00:05:00.000Z", beforeDstJump), "T1");
  assert.equal(tierForSessionDate("2026-10-10T23:30:00.000Z", beforeDstJump), "T1");
  assert.equal(tierForSessionDate("2026-10-11T23:30:00.000Z", beforeDstJump), "T2");
});

test("C2 selectDueSessions applies tier TTLs after jitter and ignores non-live sessions", () => {
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  const knownSessions: KnownSession[] = [
    known({ sessionId: "t0-too-young", tier: "T0", fetchedAt: beforeInstant(nowInstant, minutes(50)) }),
    known({ sessionId: "t0-due", tier: "T0", fetchedAt: beforeInstant(nowInstant, minutes(70)) }),
    known({ sessionId: "t1-too-young", tier: "T1", fetchedAt: beforeInstant(nowInstant, hours(5) + minutes(5)) }),
    known({ sessionId: "t1-due", tier: "T1", fetchedAt: beforeInstant(nowInstant, hours(6) + minutes(55)) }),
    known({ sessionId: "t2-too-young", tier: "T2", fetchedAt: beforeInstant(nowInstant, hours(20) + minutes(20)) }),
    known({ sessionId: "t2-due", tier: "T2", fetchedAt: beforeInstant(nowInstant, hours(27) + minutes(40)) }),
    known({ sessionId: "dead-but-old", tier: "T0", fetchedAt: beforeInstant(nowInstant, hours(12)), live: false }),
  ];

  assert.deepEqual(selectedIds(selectDueSessions(knownSessions, { budgetPerChain: 30, nowInstant })), [
    "t0-due",
    "t1-due",
    "t2-due",
  ]);
});

test("C2 selectDueSessions is tier-prioritised and round-robins across cinema/date buckets under budget", () => {
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  const dense = Array.from({ length: 5 }, (_, i) =>
    known({
      sessionId: `dense-${i + 1}`,
      tier: "T0",
      cinemaId: "C1",
      date: "2026-10-05",
      fetchedAt: beforeInstant(nowInstant, hours(8) + minutes(i)),
    }),
  );
  const laterCinema = Array.from({ length: 2 }, (_, i) =>
    known({
      sessionId: `cinema-${i + 1}`,
      tier: "T0",
      cinemaId: "C2",
      date: "2026-10-05",
      fetchedAt: beforeInstant(nowInstant, hours(5) + minutes(i)),
    }),
  );
  const laterDate = Array.from({ length: 2 }, (_, i) =>
    known({
      sessionId: `date-${i + 1}`,
      tier: "T0",
      cinemaId: "C1",
      date: "2026-10-06",
      fetchedAt: beforeInstant(nowInstant, hours(4) + minutes(i)),
    }),
  );
  const olderLowerPriority = [
    known({
      sessionId: "old-t1",
      tier: "T1",
      cinemaId: "C3",
      date: "2026-10-07",
      fetchedAt: beforeInstant(nowInstant, hours(48)),
    }),
  ];

  const result = selectDueSessions([...dense, ...laterCinema, ...laterDate, ...olderLowerPriority], {
    budgetPerChain: 5,
    nowInstant,
  });

  // Corrected by the review agent (test author): a refresh-ahead scheduler refreshes the STALEST
  // first, so within each bucket oldest-fetchedAt wins and the freshest are the dropped tail.
  assert.deepEqual(selectedIds(result), ["dense-5", "cinema-2", "date-2", "dense-4", "cinema-1"]);
  assert.equal(result.selected.length, 5);
  assert.equal(totalSkipped(result.skipped), 5);
  assert.equal(skippedAt(result.skipped, { chain: "event", tier: "T0", cinemaId: "C1", date: "2026-10-05" }), 3);
  assert.equal(skippedAt(result.skipped, { chain: "event", tier: "T0", cinemaId: "C1", date: "2026-10-06" }), 1);
  assert.equal(skippedAt(result.skipped, { chain: "event", tier: "T1", cinemaId: "C3", date: "2026-10-07" }), 1);
});

test("C2 budgetPerChain is applied independently per chain", () => {
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  const knownSessions: KnownSession[] = [
    known({ sessionId: "event-1", chain: "event", tier: "T0", fetchedAt: beforeInstant(nowInstant, hours(2)) }),
    known({ sessionId: "event-2", chain: "event", tier: "T0", fetchedAt: beforeInstant(nowInstant, hours(2)) }),
    known({ sessionId: "hoyts-1", chain: "hoyts", tier: "T0", fetchedAt: beforeInstant(nowInstant, hours(2)) }),
    known({ sessionId: "hoyts-2", chain: "hoyts", tier: "T0", fetchedAt: beforeInstant(nowInstant, hours(2)) }),
  ];

  assert.deepEqual(selectedIds(selectDueSessions(knownSessions, { budgetPerChain: 1, nowInstant })).sort(), [
    "event-1",
    "hoyts-1",
  ]);
});

// --- DB-backed P30.1 contract tests -----------------------------------------

test("C4 refresh_runs schema is additive and exposes the frozen non-null ledger columns", { skip: dbSkip }, async () => {
  const { rows } = await requirePool().query<{ column_name: string; is_nullable: "YES" | "NO" }>(
    `SELECT column_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'refresh_runs'
      ORDER BY ordinal_position`,
  );
  assert.deepEqual(
    rows.map((r) => r.column_name),
    [
      "id",
      "started_at",
      "finished_at",
      "outcome",
      "sessions_due",
      "sessions_refreshed",
      "sessions_skipped_budget",
      "sessions_new",
      "sessions_disappeared",
      "errors",
      "per_chain",
      "per_tier",
    ],
  );
  for (const column of rows.filter((r) => !["finished_at"].includes(r.column_name))) {
    assert.equal(column.is_nullable, "NO", `${column.column_name} must be non-null`);
  }
});

test("C3 advisory lock makes a second concurrent tick lock_skipped with zero upstream calls", { skip: dbSkip }, async () => {
  const watchId = await insertWatch();
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  await insertCachedSession({
    id: "S-lock",
    watchId,
    fetchedAt: beforeInstant(nowInstant, hours(3)),
  });

  const firstFetchStarted = new Deferred<void>();
  const releaseFirstFetch = new Deferred<void>();
  const firstCaptures = { queries: [] as SessionQuery[], seatMapCalls: [] as string[] };
  const secondCaptures = { queries: [] as SessionQuery[], seatMapCalls: [] as string[] };

  const firstRegistry: AdapterRegistry = {
    event: stubAdapter(
      "event",
      [],
      {
        "S-lock": async () => {
          firstFetchStarted.resolve();
          await releaseFirstFetch.promise;
          return mapFor("event", "S-lock");
        },
      },
      firstCaptures,
    ),
  };
  const secondRegistry: AdapterRegistry = {
    event: stubAdapter("event", [], { "S-lock": mapFor("event", "S-lock") }, secondCaptures),
  };

  const firstTick = runRefreshTick({ pool: requirePool(), registry: firstRegistry, nowInstant, budgetPerChain: 30 });
  await firstFetchStarted.promise;
  await runRefreshTick({ pool: requirePool(), registry: secondRegistry, nowInstant, budgetPerChain: 30 });
  releaseFirstFetch.resolve();
  await firstTick;

  assert.deepEqual(secondCaptures.queries, []);
  assert.deepEqual(secondCaptures.seatMapCalls, []);
  const rows = await refreshRunRows();
  assert.deepEqual(
    rows.map((r) => r.outcome).sort(),
    ["lock_skipped", "ok"],
  );
  const skipped = rows.find((r) => r.outcome === "lock_skipped");
  assert.ok(skipped);
  assert.equal(skipped.sessions_due, 0);
  assert.equal(skipped.sessions_refreshed, 0);
  assert.equal(skipped.sessions_skipped_budget, 0);
  assert.equal(skipped.errors, 0);
});

test("C4 clean no-due tick writes one refresh_runs row with zero fetches and non-null counters", { skip: dbSkip }, async () => {
  const watchId = await insertWatch();
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  await insertCachedSession({
    id: "S-fresh",
    watchId,
    fetchedAt: beforeInstant(nowInstant, minutes(5)),
  });
  const captures = { queries: [] as SessionQuery[], seatMapCalls: [] as string[] };
  const registry: AdapterRegistry = {
    event: stubAdapter("event", [], { "S-fresh": mapFor("event", "S-fresh") }, captures),
  };

  await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 30 });

  assert.deepEqual(captures.seatMapCalls, []);
  const rows = await refreshRunRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.outcome, "ok");
  assert.ok(rows[0]!.finished_at);
  assert.deepEqual(
    {
      sessions_due: rows[0]!.sessions_due,
      sessions_refreshed: rows[0]!.sessions_refreshed,
      sessions_skipped_budget: rows[0]!.sessions_skipped_budget,
      sessions_new: rows[0]!.sessions_new,
      sessions_disappeared: rows[0]!.sessions_disappeared,
      errors: rows[0]!.errors,
    },
    {
      sessions_due: 0,
      sessions_refreshed: 0,
      sessions_skipped_budget: 0,
      sessions_new: 0,
      sessions_disappeared: 0,
      errors: 0,
    },
  );
  assert.ok(rows[0]!.per_chain);
  assert.ok(rows[0]!.per_tier);
});

test("#47b refresh writes total_seats from the FULL seat map (real second write path, not just sweep)", { skip: dbSkip }, async () => {
  const watchId = await insertWatch();
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  // Cached row already has a (now-stale-by-fixture) total_seats from a prior sweep, to prove the
  // refresh tick actually recomputes it rather than leaving/regressing the old value.
  await insertCachedSession({
    id: "S-refresh-total",
    watchId,
    fetchedAt: beforeInstant(nowInstant, minutes(120)), // old enough to be due for T0
  });
  await requirePool().query("UPDATE sessions SET total_seats = 999 WHERE id = $1", ["S-refresh-total"]);

  const refreshedMap: SeatMap = {
    chain: "event",
    sessionId: "S-refresh-total",
    screenName: "3",
    areas: [{ id: "1", name: "Stalls", code: "std", kind: "standard" }],
    seats: [
      seat("r1", "A1", 1, 1, "available"),
      seat("r2", "A2", 1, 2, "sold"),
      seat("r3", "A3", 1, 3, "unavailable"),
      seat("r4", "A4", 1, 4, "spacer"), // excluded from sellable capacity
    ],
    geometryConfidence: "exact",
  };
  const registry: AdapterRegistry = {
    event: stubAdapter("event", [], { "S-refresh-total": refreshedMap }),
  };

  await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 30 });

  const { rows } = await requirePool().query<{ total_seats: number | null }>(
    "SELECT total_seats FROM sessions WHERE id = $1",
    ["S-refresh-total"],
  );
  assert.equal(rows[0]!.total_seats, 3); // available + sold + unavailable, spacer excluded
});

test("C5 majority-error chain backoff is recorded without starving another chain", { skip: dbSkip }, async () => {
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  const eventWatch = await insertWatch({ chain: "event", cinemaIds: ["E1"] });
  const hoytsWatch = await insertWatch({ chain: "hoyts", cinemaIds: ["H1"] });
  for (const id of ["E1", "E2", "E3"]) {
    await insertCachedSession({ id, watchId: eventWatch, chain: "event", cinemaId: "E1", fetchedAt: beforeInstant(nowInstant, hours(3)) });
  }
  for (const id of ["H1", "H2"]) {
    await insertCachedSession({ id, watchId: hoytsWatch, chain: "hoyts", cinemaId: "H1", fetchedAt: beforeInstant(nowInstant, hours(3)) });
  }
  const eventCaptures = { seatMapCalls: [] as string[] };
  const hoytsCaptures = { seatMapCalls: [] as string[] };
  const registry: AdapterRegistry = {
    event: stubAdapter(
      "event",
      [],
      { E1: new Error("event upstream"), E2: new Error("event upstream"), E3: mapFor("event", "E3") },
      eventCaptures,
    ),
    hoyts: stubAdapter("hoyts", [], { H1: mapFor("hoyts", "H1"), H2: mapFor("hoyts", "H2") }, hoytsCaptures),
  };

  await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 30, concurrency: 2 });

  assert.deepEqual(eventCaptures.seatMapCalls.sort(), ["E1", "E2", "E3"]);
  assert.deepEqual(hoytsCaptures.seatMapCalls.sort(), ["H1", "H2"]);
  const rows = await refreshRunRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.outcome, "ok");
  assert.equal(rows[0]!.sessions_refreshed, 3);
  assert.equal(rows[0]!.errors, 2);
  const perChain = asRecord(rows[0]!.per_chain);
  assert.equal((perChain.event as Record<string, unknown>).backoff, true);
  assert.equal((perChain.hoyts as Record<string, unknown>).backoff, false);
  assert.equal((perChain.hoyts as Record<string, unknown>).refreshed, 2);
});

test("discovery inserts a new session as due without testing P30.2 tombstones", { skip: dbSkip }, async () => {
  await insertWatch({ chain: "event", cinemaIds: ["C1"], dateFrom: "2026-10-05", dateTo: "2026-10-05" });
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  const discovered = session("S-new", "event", "C1", "2026-10-05T19:00:00.000Z");
  const captures = { queries: [] as SessionQuery[], seatMapCalls: [] as string[] };
  const registry: AdapterRegistry = {
    event: stubAdapter("event", [discovered], { "S-new": mapFor("event", "S-new") }, captures),
  };

  await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 30 });

  assert.deepEqual(captures.seatMapCalls, ["S-new"]);
  const stored = await requirePool().query<{ id: string; fetched_at: Date }>("SELECT id, fetched_at FROM sessions WHERE id = $1", [
    "S-new",
  ]);
  assert.equal(stored.rows.length, 1);
  const rows = await refreshRunRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.sessions_new, 1);
  assert.equal(rows[0]!.sessions_due, 1);
  assert.equal(rows[0]!.sessions_refreshed, 1);
  assert.equal(rows[0]!.sessions_disappeared, 0, "P30.2 tombstones are deliberately out of scope here");
});

test("over-budget tick: sessions_due = refreshed + errors + skipped and skip bucket detail survives into the ledger", { skip: dbSkip }, async () => {
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  const watchId = await insertWatch({ chain: "event", cinemaIds: ["C1", "C2"], dateFrom: "2026-10-05", dateTo: "2026-10-05" });
  // Two (cinemaId,date) buckets, two members each, all T0/due, distinct ages so selection is deterministic.
  await insertCachedSession({ id: "s-c1-old", watchId, cinemaId: "C1", date: "2026-10-05", fetchedAt: beforeInstant(nowInstant, hours(5)) });
  await insertCachedSession({ id: "s-c1-new", watchId, cinemaId: "C1", date: "2026-10-05", fetchedAt: beforeInstant(nowInstant, hours(3)) });
  await insertCachedSession({ id: "s-c2-old", watchId, cinemaId: "C2", date: "2026-10-05", fetchedAt: beforeInstant(nowInstant, hours(4)) });
  await insertCachedSession({ id: "s-c2-new", watchId, cinemaId: "C2", date: "2026-10-05", fetchedAt: beforeInstant(nowInstant, minutes(210)) });
  const maps: Record<string, SeatMap> = {
    "s-c1-old": mapFor("event", "s-c1-old"),
    "s-c1-new": mapFor("event", "s-c1-new"),
    "s-c2-old": mapFor("event", "s-c2-old"),
    "s-c2-new": mapFor("event", "s-c2-new"),
  };
  const registry: AdapterRegistry = { event: stubAdapter("event", [], maps) };

  const row = await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 2 });

  assert.equal(row.outcome, "ok");
  assert.equal(row.sessions_due, 4);
  assert.equal(row.sessions_refreshed, 2);
  assert.equal(row.errors, 0);
  assert.equal(row.sessions_skipped_budget, 2);
  assert.equal(
    row.sessions_due,
    row.sessions_refreshed + row.errors + row.sessions_skipped_budget,
    "the due set must equal refreshed + errors + budget-skipped",
  );

  const perChain = asRecord(row.per_chain);
  const event = perChain.event as Record<string, unknown>;
  assert.equal(event.due, 4);
  assert.equal(event.skipped, 2);
  const buckets = event.skipped_buckets as Array<Record<string, unknown>>;
  assert.equal(buckets.reduce((sum, b) => sum + Number(b.count), 0), 2);
  assert.deepEqual(
    buckets.map((b) => `${String(b.cinemaId)}|${String(b.date)}`).sort(),
    ["C1|2026-10-05", "C2|2026-10-05"],
  );

  const perTier = asRecord(row.per_tier);
  const t0 = perTier.T0 as Record<string, unknown>;
  assert.equal(t0.count, 4, "per_tier reflects the whole due set, not just the selected slice");

  const rows = await refreshRunRows();
  assert.equal(rows.length, 1);
});

test("a tick that throws after acquiring the lock writes one outcome='error' row and releases the lock", { skip: dbSkip }, async () => {
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  const realPool = requirePool();
  // connect() (advisory lock acquire) works; query() (the locked body's DB work) throws.
  const failingPool = {
    connect: () => realPool.connect(),
    query: () => {
      throw new Error("simulated DB failure after lock");
    },
  } as unknown as ReturnType<typeof createPool>;

  await assert.rejects(
    runRefreshTick({
      pool: failingPool,
      registry: { event: stubAdapter("event", [], {}) },
      nowInstant,
      budgetPerChain: 30,
    }),
    /simulated DB failure/,
  );

  const rows = await refreshRunRows();
  assert.equal(rows.length, 1, "exactly one ledger row even on a hard failure");
  assert.equal(rows[0]!.outcome, "error");
  assert.equal(rows[0]!.sessions_due, 0);
  assert.equal(rows[0]!.errors, 1);
  assert.ok(rows[0]!.finished_at);

  // The advisory lock must have been released: a healthy tick now acquires it and completes.
  const okRow = await runRefreshTick({
    pool: realPool,
    registry: { event: stubAdapter("event", [], {}) },
    nowInstant,
    budgetPerChain: 30,
  });
  assert.equal(okRow.outcome, "ok");
});

test("discovery-error-only tick: invariant holds, errors stay zero, discovery_errors > 0 and backs the chain off", { skip: dbSkip }, async () => {
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  // A watch exists (so discovery runs) but listSessions throws; no due sessions exist.
  await insertWatch({ chain: "event", cinemaIds: ["C1"], dateFrom: "2026-10-05", dateTo: "2026-10-05" });
  const registry: AdapterRegistry = {
    event: {
      chain: "event",
      async listCinemas(): Promise<Cinema[]> {
        return [];
      },
      async listSessions(): Promise<Session[]> {
        throw new Error("event listing upstream down");
      },
      async getSeatMap(): Promise<SeatMap> {
        throw new Error("unused");
      },
    },
  };

  const row = await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 30 });

  assert.equal(row.outcome, "ok");
  assert.equal(row.sessions_due, 0, "a discovery outage produces no due sessions");
  assert.equal(row.sessions_refreshed, 0);
  assert.equal(row.errors, 0, "top-level errors are seat-refresh errors of due sessions only");
  assert.equal(row.sessions_skipped_budget, 0);
  assert.equal(
    row.sessions_due,
    row.sessions_refreshed + row.errors + row.sessions_skipped_budget,
    "the invariant must hold even on a discovery-error tick",
  );

  const perChain = asRecord(row.per_chain);
  const event = perChain.event as Record<string, unknown>;
  assert.ok(Number(event.discovery_errors) > 0, "discovery errors are accounted separately");
  assert.equal(event.errors, 0, "discovery errors are not folded into per-chain seat-refresh errors");
  assert.equal(event.backoff, true, "a discovery outage still backs the chain off");
});

// --- #67/#72 self-heal: blank/stale cached names heal from fresh discovery data --------------

test("#67/#72 self-heal: a KNOWN session id with blank cached names is healed from fresh discovery data", { skip: dbSkip }, async () => {
  const watchId = await insertWatch({ chain: "event", cinemaIds: ["C1"], dateFrom: "2026-10-05", dateTo: "2026-10-05" });
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  await insertCachedSession({
    id: "S-blank",
    watchId,
    fetchedAt: beforeInstant(nowInstant, hours(3)), // old enough to be due for T0
  });
  // Simulate the #67/#72 symptom: the cached row already carries blank names.
  await requirePool().query("UPDATE sessions SET movie_name = '', cinema_name = NULL WHERE id = $1", ["S-blank"]);

  // This tick's discovery listing returns the SAME (already-known) session id, with real names —
  // exactly what a healthy Hoyts/Reading/etc. listing looks like post-#69/#72 adapter fixes.
  const fresh = session("S-blank", "event", "C1", "2026-10-05T19:00:00.000Z", {
    movieName: "Real Movie Title",
    cinemaName: "Real Cinema Name",
  });
  const registry: AdapterRegistry = {
    event: stubAdapter("event", [fresh], { "S-blank": mapFor("event", "S-blank") }),
  };

  await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 30 });

  const { rows } = await requirePool().query<{
    movie_name: string | null;
    cinema_name: string | null;
    total_seats: number | null;
  }>("SELECT movie_name, cinema_name, total_seats FROM sessions WHERE id = $1", ["S-blank"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.movie_name, "Real Movie Title", "blank movie_name heals from fresh discovery data");
  assert.equal(rows[0]!.cinema_name, "Real Cinema Name", "blank cinema_name heals from fresh discovery data");

  // Seat/total_seats flow is unaffected by the name-healing change: the seat map still writes
  // through normally (mapFor's 2 available seats -> total_seats 2, session_seats populated).
  assert.equal(rows[0]!.total_seats, 2);
  const seats = await requirePool().query<{ seat_id: string }>(
    "SELECT seat_id FROM session_seats WHERE session_id = $1 ORDER BY seat_id",
    ["S-blank"],
  );
  assert.deepEqual(
    seats.rows.map((r) => r.seat_id),
    ["S-blank-A1", "S-blank-A2"],
  );
});

test("#67/#72 self-heal policy: non-blank cached names are NOT overwritten by a differing fresh listing", { skip: dbSkip }, async () => {
  const watchId = await insertWatch({ chain: "event", cinemaIds: ["C1"], dateFrom: "2026-10-05", dateTo: "2026-10-05" });
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  // insertCachedSession seeds non-blank names: movie_name = "Test Movie", cinema_name = "Cinema C1".
  await insertCachedSession({
    id: "S-nonblank",
    watchId,
    fetchedAt: beforeInstant(nowInstant, hours(3)),
  });

  // Fresh listing disagrees (e.g. a same-id re-release relabel upstream) — conservative v1 policy
  // is fresh-wins-ONLY-when-DB-blank, so the existing non-blank DB value must survive untouched.
  const fresh = session("S-nonblank", "event", "C1", "2026-10-05T19:00:00.000Z", {
    movieName: "Different Movie",
    cinemaName: "Different Cinema",
  });
  const registry: AdapterRegistry = {
    event: stubAdapter("event", [fresh], { "S-nonblank": mapFor("event", "S-nonblank") }),
  };

  await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 30 });

  const { rows } = await requirePool().query<{ movie_name: string | null; cinema_name: string | null }>(
    "SELECT movie_name, cinema_name FROM sessions WHERE id = $1",
    ["S-nonblank"],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.movie_name, "Test Movie", "non-blank DB movie_name is preserved, not overwritten");
  assert.equal(rows[0]!.cinema_name, "Cinema C1", "non-blank DB cinema_name is preserved, not overwritten");
});

test("#67/#72 self-heal: whitespace-only cached names are treated as blank and heal (isBlank trims)", { skip: dbSkip }, async () => {
  const watchId = await insertWatch({ chain: "event", cinemaIds: ["C1"], dateFrom: "2026-10-05", dateTo: "2026-10-05" });
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  await insertCachedSession({
    id: "S-whitespace",
    watchId,
    fetchedAt: beforeInstant(nowInstant, hours(3)),
  });
  // Whitespace-only, not empty-string - isBlank trims before checking, so this must heal too.
  await requirePool().query("UPDATE sessions SET movie_name = '   ', cinema_name = '\t \n' WHERE id = $1", [
    "S-whitespace",
  ]);

  const fresh = session("S-whitespace", "event", "C1", "2026-10-05T19:00:00.000Z", {
    movieName: "Real Movie Title",
    cinemaName: "Real Cinema Name",
  });
  const registry: AdapterRegistry = {
    event: stubAdapter("event", [fresh], { "S-whitespace": mapFor("event", "S-whitespace") }),
  };

  await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 30 });

  const { rows } = await requirePool().query<{ movie_name: string | null; cinema_name: string | null }>(
    "SELECT movie_name, cinema_name FROM sessions WHERE id = $1",
    ["S-whitespace"],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.movie_name, "Real Movie Title", "whitespace-only movie_name heals (isBlank trims)");
  assert.equal(rows[0]!.cinema_name, "Real Cinema Name", "whitespace-only cinema_name heals (isBlank trims)");
});

// --- #75 review follow-up: name heal decoupled from the seat-refresh write --------------------

test("#75 name heal is decoupled from seat-refresh: a NOT-due known row still heals when discovery lists it", { skip: dbSkip }, async () => {
  const watchId = await insertWatch({ chain: "event", cinemaIds: ["C1"], dateFrom: "2026-10-05", dateTo: "2026-10-05" });
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  // fetchedAt = nowInstant itself -> age 0, well under the T0 TTL, so this row is NOT due and will
  // never be selected into sel.selected / upsertSessionWithSeats this tick.
  await insertCachedSession({ id: "S-not-due", watchId, fetchedAt: nowInstant });
  await requirePool().query("UPDATE sessions SET movie_name = '', cinema_name = NULL WHERE id = $1", ["S-not-due"]);

  const fresh = session("S-not-due", "event", "C1", "2026-10-05T19:00:00.000Z", {
    movieName: "Real Movie Title",
    cinemaName: "Real Cinema Name",
  });
  const seatMapCalls: string[] = [];
  // No map registered for "S-not-due" - if it were ever selected for seat-refresh, getSeatMap would
  // throw "no map for S-not-due"; asserting seatMapCalls stays empty below proves it never was.
  const registry: AdapterRegistry = {
    event: stubAdapter("event", [fresh], {}, { seatMapCalls }),
  };

  const result = await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 30 });

  assert.deepEqual(seatMapCalls, [], "the not-due row was never selected for seat-refresh");
  assert.equal(result.sessions_refreshed, 0, "no seat-refresh happened this tick");

  const { rows } = await requirePool().query<{ movie_name: string | null; cinema_name: string | null }>(
    "SELECT movie_name, cinema_name FROM sessions WHERE id = $1",
    ["S-not-due"],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.movie_name, "Real Movie Title", "a NOT-due row still heals its blank name from discovery");
  assert.equal(rows[0]!.cinema_name, "Real Cinema Name", "a NOT-due row still heals its blank cinema name too");
});

test("#75 name heal is decoupled from seat-refresh: a getSeatMap failure does not block the heal", { skip: dbSkip }, async () => {
  const watchId = await insertWatch({ chain: "event", cinemaIds: ["C1"], dateFrom: "2026-10-05", dateTo: "2026-10-05" });
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  // Old enough to be due this tick, so it IS selected for seat-refresh - but its getSeatMap fails.
  await insertCachedSession({ id: "S-seatmap-fail", watchId, fetchedAt: beforeInstant(nowInstant, hours(3)) });
  await requirePool().query("UPDATE sessions SET movie_name = '', cinema_name = NULL WHERE id = $1", [
    "S-seatmap-fail",
  ]);

  const fresh = session("S-seatmap-fail", "event", "C1", "2026-10-05T19:00:00.000Z", {
    movieName: "Real Movie Title",
    cinemaName: "Real Cinema Name",
  });
  const registry: AdapterRegistry = {
    event: stubAdapter("event", [fresh], {
      "S-seatmap-fail": new Error("upstream 429"),
    }),
  };

  const result = await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 30 });

  const perChain = asRecord(result.per_chain);
  const event = perChain.event as Record<string, unknown>;
  assert.ok(Number(event.errors) > 0, "the seat-refresh attempt recorded a failure");

  const { rows } = await requirePool().query<{
    movie_name: string | null;
    cinema_name: string | null;
    total_seats: number | null;
  }>("SELECT movie_name, cinema_name, total_seats FROM sessions WHERE id = $1", ["S-seatmap-fail"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.movie_name, "Real Movie Title", "a getSeatMap failure does not block the name heal");
  assert.equal(rows[0]!.cinema_name, "Real Cinema Name", "cinema name heals too, despite the failed seat-refresh");
  // upsertSessionWithSeats was never reached for this session (it threw before that call), so
  // total_seats/session_seats are untouched by the (failed) seat-refresh attempt - proving the heal
  // write is a genuinely separate path, not a side effect of the seat upsert.
  assert.equal(rows[0]!.total_seats, null, "seat-refresh never completed, so total_seats is untouched");
});

// --- movielist-posters-sort: poster_url rides the same self-heal + upsert-thread path ----------

test("poster self-heal: a KNOWN session with a blank cached poster_url heals from fresh discovery data", { skip: dbSkip }, async () => {
  const watchId = await insertWatch({ chain: "event", cinemaIds: ["C1"], dateFrom: "2026-10-05", dateTo: "2026-10-05" });
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  await insertCachedSession({
    id: "S-poster-blank",
    watchId,
    fetchedAt: beforeInstant(nowInstant, hours(3)),
  });
  // insertCachedSession never sets poster_url — the column defaults NULL, same starting state as
  // a pre-#92 row.

  const fresh = session("S-poster-blank", "event", "C1", "2026-10-05T19:00:00.000Z", {
    posterUrl: "https://cdn.eventcinemas.com.au/poster.jpg",
  });
  const registry: AdapterRegistry = {
    event: stubAdapter("event", [fresh], { "S-poster-blank": mapFor("event", "S-poster-blank") }),
  };

  await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 30 });

  const { rows } = await requirePool().query<{ poster_url: string | null }>(
    "SELECT poster_url FROM sessions WHERE id = $1",
    ["S-poster-blank"],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.poster_url, "https://cdn.eventcinemas.com.au/poster.jpg");
});

test("#92 regression: a stored poster_url is NOT NULLed out by a refresh tick whose discovery returned no poster", { skip: dbSkip }, async () => {
  const watchId = await insertWatch({ chain: "event", cinemaIds: ["C1"], dateFrom: "2026-10-05", dateTo: "2026-10-05" });
  const nowInstant = new Date("2026-10-05T00:00:00.000Z");
  await insertCachedSession({
    id: "S-poster-keep",
    watchId,
    fetchedAt: beforeInstant(nowInstant, hours(3)),
  });
  await requirePool().query("UPDATE sessions SET poster_url = $2 WHERE id = $1", [
    "S-poster-keep",
    "https://cdn.eventcinemas.com.au/already-cached-poster.jpg",
  ]);

  // This tick's discovery returns the session again but with NO posterUrl (e.g. a chain listing
  // that doesn't carry artwork this tick, or Event's own PosterUrl field momentarily absent) —
  // upsertSessionWithSeats writes every column from EXCLUDED on this session's due-refresh write,
  // so if the known-row rebuild in refresh.ts didn't thread the DB's existing poster_url through,
  // this write would silently NULL it out.
  const fresh = session("S-poster-keep", "event", "C1", "2026-10-05T19:00:00.000Z", {});
  delete (fresh as { posterUrl?: string }).posterUrl;
  const registry: AdapterRegistry = {
    event: stubAdapter("event", [fresh], { "S-poster-keep": mapFor("event", "S-poster-keep") }),
  };

  await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 30 });

  const { rows } = await requirePool().query<{ poster_url: string | null }>(
    "SELECT poster_url FROM sessions WHERE id = $1",
    ["S-poster-keep"],
  );
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0]!.poster_url,
    "https://cdn.eventcinemas.com.au/already-cached-poster.jpg",
    "the session's own due-refresh upsert must not NULL out a poster the DB already had",
  );
});
