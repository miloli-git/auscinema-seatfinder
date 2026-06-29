import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Chain, ChainAdapter, Cinema, Seat, SeatMap, Session, SessionQuery } from "@auscinema/core";
import { createPool, runRefreshTick, type AdapterRegistry, type WatchRow } from "./index.js";

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

const MS_PER_DAY = 86_400_000;
const SYDNEY_TZ = "Australia/Sydney";

function minutes(n: number): number {
  return n * 60_000;
}

function hours(n: number): number {
  return n * 60 * 60_000;
}

function beforeInstant(now: Date, ageMs: number): Date {
  return new Date(now.getTime() - ageMs);
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addCalendarDaysForTest(ymdDate: string, days: number): string {
  return ymd(new Date(Date.parse(`${ymdDate}T00:00:00Z`) + days * MS_PER_DAY));
}

function sydneyDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SYDNEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function ymdOf(v: string | Date): string {
  if (v instanceof Date) return ymd(new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())));
  return String(v).slice(0, 10);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
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
  };
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

test(
  "H11 rolling horizon discovers and fetches a far-future session beyond static dateTo despite a T0 budget flood",
  { skip: dbSkip },
  async () => {
    const previousReserve = process.env.REFRESH_RESERVE_NEW_PER_CHAIN;
    const previousHorizon = process.env.REFRESH_HORIZON_DAYS;
    process.env.REFRESH_RESERVE_NEW_PER_CHAIN = "1";
    process.env.REFRESH_HORIZON_DAYS = "35";

    try {
      const nowInstant = new Date("2026-06-29T01:00:00.000Z");
      const today = sydneyDate(nowInstant);
      const staticDateTo = addCalendarDaysForTest(today, 5);
      const farDate = addCalendarDaysForTest(today, 20);
      const watchId = await insertWatch({ dateFrom: today, dateTo: staticDateTo });

      const nearIds = Array.from({ length: 5 }, (_, i) => `near-t0-${i + 1}`);
      for (const [i, id] of nearIds.entries()) {
        await insertCachedSession({
          id,
          watchId,
          date: today,
          fetchedAt: beforeInstant(nowInstant, hours(3) + minutes(i)),
        });
      }

      const farSession = session("far-future-t2", "event", "C1", `${farDate}T19:00:00.000Z`);
      const maps: Record<string, SeatMap> = { [farSession.id]: mapFor("event", farSession.id) };
      for (const id of nearIds) maps[id] = mapFor("event", id);

      const captures = { queries: [] as SessionQuery[], seatMapCalls: [] as string[] };
      const registry: AdapterRegistry = {
        event: stubAdapter("event", [farSession], maps, captures),
      };

      const row = await runRefreshTick({ pool: requirePool(), registry, nowInstant, budgetPerChain: 3 });

      assert.ok(captures.queries.some((q) => q.date === farDate), "discovery must query through the rolling horizon");
      assert.ok(captures.seatMapCalls.includes(farSession.id), "the far-future first-ingest session must be fetched");
      assert.ok(row.sessions_new >= 1, "the tick must record at least one newly fetched session");

      const stored = await requirePool().query<{ id: string; date: string | Date }>(
        "SELECT id, date FROM sessions WHERE id = $1",
        [farSession.id],
      );
      assert.equal(stored.rows.length, 1);
      assert.equal(stored.rows[0]!.id, farSession.id);
      assert.equal(ymdOf(stored.rows[0]!.date), farDate);
    } finally {
      restoreEnv("REFRESH_RESERVE_NEW_PER_CHAIN", previousReserve);
      restoreEnv("REFRESH_HORIZON_DAYS", previousHorizon);
    }
  },
);
