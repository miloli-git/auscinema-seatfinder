import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPool } from "@auscinema/ingester";
import { buildServer } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
const hasDatabase = Boolean(databaseUrl);
const dbSkip = hasDatabase ? false : "DATABASE_URL is unset";
const schemaName = `p302_api_${process.pid}`;

let schemaSql = "";
let adminPool: ReturnType<typeof createPool> | undefined;
let pool: ReturnType<typeof createPool> | undefined;

type Pool = ReturnType<typeof createPool>;

type TogetherResponse = {
  party: number;
  minScore: number;
  count: number;
  results: Array<{
    session: { id: string; date: string; startTime: string | null };
    block: unknown;
    approximateAdjacency: boolean;
    fetchedAt: string;
  }>;
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
    "refusing to run destructive P30.2 API tests against the live seatfinder database",
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

const SYDNEY_TZ = "Australia/Sydney";
const MS_PER_DAY = 86_400_000;

function sydneyDate(instant = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SYDNEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(ymd: string, offset: number): string {
  const next = new Date(Date.parse(`${ymd}T00:00:00.000Z`) + offset * MS_PER_DAY);
  return next.toISOString().slice(0, 10);
}

async function insertSession(args: {
  id: string;
  date: string;
  startTime: string;
  disappearedAt?: string | null;
}): Promise<void> {
  await requirePool().query(
    `INSERT INTO sessions
       (id, chain, movie_id, movie_name, cinema_id, cinema_name, date, start_time,
        format, screen, seats_available, booking_url, seat_allocation, fetched_at, last_seen,
        disappeared_at)
     VALUES
       ($1, 'event', 'M1', 'Test Movie', 'C1', 'Test Cinema', $2, $3,
        'V-Max', '3', 42, $4, true, $5, $5, $6)`,
    [
      args.id,
      args.date,
      args.startTime,
      `https://example.test/book?sid=${args.id}`,
      `${args.date}T01:00:00.000Z`,
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
  const server = buildServer({ pool: requirePool(), rateLimit: false, logger: false });
  const res = await server.inject({ method: "GET", url: `/together?${query}` });
  assert.equal(res.statusCode, 200);
  return res.json() as TogetherResponse;
}

function resultIds(body: TogetherResponse): string[] {
  return body.results.map((r) => r.session.id);
}

test("C6 /together excludes tombstoned and past-date sessions using Sydney fake-Z wall dates", { skip: dbSkip }, async () => {
  const today = sydneyDate();
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);

  await insertSession({
    id: "live-future",
    date: tomorrow,
    startTime: `${tomorrow}T19:00:00.000Z`,
  });
  await insertSession({
    id: "gone-future",
    date: tomorrow,
    startTime: `${tomorrow}T20:00:00.000Z`,
    disappearedAt: `${today}T00:00:00.000Z`,
  });
  await insertSession({
    id: "past-fake-z-late-night",
    date: yesterday,
    startTime: `${yesterday}T23:30:00.000Z`,
  });
  await insertSeats("live-future");
  await insertSeats("gone-future");
  await insertSeats("past-fake-z-late-night");

  const body = await getTogether(`chain=event&dateFrom=${yesterday}&dateTo=${tomorrow}&party=2&minScore=74`);

  assert.equal(body.count, 1);
  assert.deepEqual(resultIds(body), ["live-future"]);
  assert.equal(body.results[0]!.session.date, tomorrow);
  assert.equal(
    body.results.some((r) => r.session.id === "past-fake-z-late-night"),
    false,
    "a yesterday 23:30 fake-Z showtime is past by substring even though UTC parsing maps it into Sydney today",
  );
});
