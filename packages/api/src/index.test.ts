import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EventCinemasAdapter, type FetchJson } from "@auscinema/adapter-event";
import {
  UpstreamError,
  type Chain,
  type ChainAdapter,
  type Cinema,
  type SeatMap,
  type Session,
  type SessionQuery,
} from "@auscinema/core";
import { buildServer } from "./index.js";

// --- Lightweight in-memory ChainAdapter for route-level tests (no fixtures, no network). -----

interface FakeAdapterOpts {
  chain?: Chain;
  cinemas?: Cinema[];
  sessions?: Session[];
  listSessions?: (q: SessionQuery) => Promise<Session[]>;
  getSeatMap?: (sessionId: string) => Promise<SeatMap>;
  seatMapCalls?: string[];
}

/** A one-available-seat map so the seat scorer has something to rank. */
function tinySeatMap(sessionId: string, chain: Chain): SeatMap {
  return {
    chain,
    sessionId,
    areas: [{ id: "1", name: "Standard", kind: "standard" }],
    seats: [
      { id: `${sessionId}-s1`, name: "A1", rowLabel: "A", row: 0, col: 0, status: "available", areaId: "1" },
      { id: `${sessionId}-s2`, name: "B1", rowLabel: "B", row: 1, col: 0, status: "available", areaId: "1" },
    ],
  };
}

function makeSession(id: string, chain: Chain, seatsAvailable?: number): Session {
  return {
    chain,
    id,
    movieId: "m1",
    movieName: "Test Movie",
    cinemaId: "c1",
    cinemaName: "Test Cinema",
    startTime: "2026-07-21T09:30",
    format: { kind: "standard", raw: "Standard" },
    seatsAvailable,
    seatAllocation: true,
    bookingUrl: `https://example.test/book?sessionId=${id}`,
  };
}

function fakeAdapter(opts: FakeAdapterOpts = {}): ChainAdapter {
  const chain = opts.chain ?? "event";
  return {
    chain,
    async listCinemas(): Promise<Cinema[]> {
      return opts.cinemas ?? [];
    },
    async listSessions(q: SessionQuery): Promise<Session[]> {
      if (opts.listSessions) return opts.listSessions(q);
      return opts.sessions ?? [];
    },
    async getSeatMap(sessionId: string): Promise<SeatMap> {
      opts.seatMapCalls?.push(sessionId);
      if (opts.getSeatMap) return opts.getSeatMap(sessionId);
      return tinySeatMap(sessionId, chain);
    },
  };
}

// Fixtures are committed in the event adapter package. Compiled test runs from
// packages/api/dist/, so ../../adapters/event/fixtures/ resolves to packages/adapters/event/fixtures/.
function loadFixture(name: string): unknown {
  const url = new URL(`../../adapters/event/fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

/**
 * Build a real EventCinemasAdapter whose injected fetchJson routes to the committed fixtures
 * by URL, so the server exercises the genuine adapter parsing with zero network.
 */
function stubEventAdapter(): EventCinemasAdapter {
  const sessions = loadFixture("getsessions.burwood.odyssey.json");
  const seating = loadFixture("getseating.session-15433720.json");
  const fetchJson: FetchJson = async (url) => {
    if (url.includes("/Cinemas/GetSessions")) return sessions;
    if (url.includes("/Ticketing/Order/GetSeating")) return seating;
    if (url.includes("/api/cinemas/JsonLd")) return [];
    throw new Error(`unexpected url in stub: ${url}`);
  };
  return new EventCinemasAdapter({ fetchJson });
}

function app() {
  return buildServer({ adapters: { event: stubEventAdapter() }, logger: false });
}

test("GET /healthz -> 200 {ok:true}", async () => {
  const server = app();
  const res = await server.inject({ method: "GET", url: "/healthz" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
});

test("GET /sessions returns fixture sessions; missing param -> 400", async () => {
  const server = app();
  const ok = await server.inject({
    method: "GET",
    url: "/sessions?chain=event&movieId=19797&cinemaIds=58&date=2026-07-21",
  });
  assert.equal(ok.statusCode, 200);
  const sessions = ok.json() as Array<{ id: string; movieName: string }>;
  assert.equal(sessions.length, 8);
  assert.equal(sessions[0]!.id, "15433720");
  assert.equal(sessions[0]!.movieName, "The Odyssey");

  const missing = await server.inject({ method: "GET", url: "/sessions?chain=event&movieId=19797" });
  assert.equal(missing.statusCode, 400);
  assert.ok((missing.json() as { error: string }).error.length > 0);
});

test("GET /seatmap returns scored seats sorted desc, scores in 0..100", async () => {
  const server = app();
  const res = await server.inject({
    method: "GET",
    url: "/seatmap?chain=event&sessionId=15433720",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    sessionId: string;
    seats: unknown[];
    scored: Array<{ seat: { name?: string }; score: number }>;
  };
  assert.equal(body.sessionId, "15433720");
  assert.ok(body.scored.length > 0, "expected scored seats");
  for (const { score } of body.scored) {
    assert.ok(score >= 0 && score <= 100, `score ${score} out of range`);
  }
  // Sorted best-first.
  for (let i = 1; i < body.scored.length; i++) {
    assert.ok(body.scored[i - 1]!.score >= body.scored[i]!.score, "scored not sorted desc");
  }
});

test("GET /best orders sessions by best seat; unknown chain -> 400", async () => {
  const server = app();
  const res = await server.inject({
    method: "GET",
    url: "/best?chain=event&movieId=19797&cinemaIds=58&date=2026-07-21",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    sessions: Array<{ bestScore: number; bookingUrl: string; topSeats: unknown[] }>;
    skipped: unknown[];
  };
  assert.ok(body.sessions.length > 0, "expected scored sessions");
  for (let i = 1; i < body.sessions.length; i++) {
    assert.ok(
      body.sessions[i - 1]!.bestScore >= body.sessions[i]!.bestScore,
      "sessions not ordered by best seat desc",
    );
  }
  assert.ok(body.sessions[0]!.bookingUrl.includes("sessionId="));
  assert.ok(body.sessions[0]!.topSeats.length <= 5);

  const unknown = await server.inject({
    method: "GET",
    url: "/best?chain=nope&movieId=1&cinemaIds=1&date=2026-07-21",
  });
  assert.equal(unknown.statusCode, 400);
});

// --- Gap 1: rate limiting ---------------------------------------------------

test("rate limit: Nth request over the limit -> 429 with {error} shape", async () => {
  const server = buildServer({
    adapters: { event: stubEventAdapter() },
    rateLimit: { max: 3, windowMs: 60_000 },
    logger: false,
  });
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) {
    const res = await server.inject({ method: "GET", url: "/healthz" });
    codes.push(res.statusCode);
  }
  // First 3 allowed, 4th rejected.
  assert.deepEqual(codes.slice(0, 3), [200, 200, 200]);
  assert.equal(codes[3], 429);

  const limited = await server.inject({ method: "GET", url: "/healthz" });
  assert.equal(limited.statusCode, 429);
  const body = limited.json() as { error?: string };
  assert.equal(typeof body.error, "string");
  assert.ok((body.error ?? "").length > 0, "429 keeps the central {error} shape");
});

test("rate limit: disabled (rateLimit:false) lets many requests through", async () => {
  const server = buildServer({
    adapters: { event: stubEventAdapter() },
    rateLimit: false,
    logger: false,
  });
  for (let i = 0; i < 20; i++) {
    const res = await server.inject({ method: "GET", url: "/healthz" });
    assert.equal(res.statusCode, 200);
  }
});

// --- Gap 2: /best session cap (no silent truncation) ------------------------

test("/best caps fan-out to maxSessions and reports droppedSessions", async () => {
  const seatMapCalls: string[] = [];
  const sessions = [
    makeSession("s-lo", "event", 10),
    makeSession("s-hi", "event", 200),
    makeSession("s-mid", "event", 120),
    makeSession("s-unknown", "event", undefined),
  ];
  const adapter = fakeAdapter({ sessions, seatMapCalls });
  const server = buildServer({ adapters: { event: adapter }, maxSessions: 2, logger: false });

  const res = await server.inject({
    method: "GET",
    url: "/best?chain=event&movieId=m1&cinemaIds=c1&date=2026-07-21",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    sessions: Array<{ session: { id: string } }>;
    consideredSessions: number;
    droppedSessions: number;
  };
  // 4 allocatable candidates, capped to 2 -> 2 dropped, only 2 seat maps fetched.
  assert.equal(body.consideredSessions, 2);
  assert.equal(body.droppedSessions, 2);
  assert.equal(seatMapCalls.length, 2);
  // Cap keeps the highest-availability sessions (200 and 120), not the low/undefined ones.
  assert.deepEqual([...seatMapCalls].sort(), ["s-hi", "s-mid"]);
});

test("/best ?maxSessions= query override beats the server default", async () => {
  const seatMapCalls: string[] = [];
  const sessions = [
    makeSession("a", "event", 50),
    makeSession("b", "event", 40),
    makeSession("c", "event", 30),
  ];
  const adapter = fakeAdapter({ sessions, seatMapCalls });
  const server = buildServer({ adapters: { event: adapter }, maxSessions: 40, logger: false });

  const res = await server.inject({
    method: "GET",
    url: "/best?chain=event&movieId=m1&cinemaIds=c1&date=2026-07-21&maxSessions=1",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { consideredSessions: number; droppedSessions: number };
  assert.equal(body.consideredSessions, 1);
  assert.equal(body.droppedSessions, 2);
  assert.equal(seatMapCalls.length, 1);
});

// --- Gap 3: UpstreamError -> 502/503 mapping --------------------------------

test("UpstreamError(kind:http) from adapter -> 502, not 500", async () => {
  const adapter = fakeAdapter({
    listSessions: async () => {
      throw new UpstreamError("upstream 503", { kind: "http", status: 503 });
    },
  });
  const server = buildServer({ adapters: { event: adapter }, logger: false });
  const res = await server.inject({
    method: "GET",
    url: "/best?chain=event&movieId=m1&cinemaIds=c1&date=2026-07-21",
  });
  assert.equal(res.statusCode, 502);
  assert.equal(typeof (res.json() as { error?: string }).error, "string");
});

test("UpstreamError(kind:timeout) -> 503", async () => {
  const adapter = fakeAdapter({
    getSeatMap: async () => {
      throw new UpstreamError("upstream timed out", { kind: "timeout" });
    },
    sessions: [makeSession("s1", "event", 100)],
  });
  const server = buildServer({ adapters: { event: adapter }, logger: false });
  const res = await server.inject({
    method: "GET",
    url: "/best?chain=event&movieId=m1&cinemaIds=c1&date=2026-07-21",
  });
  assert.equal(res.statusCode, 503);
});

test("a non-UpstreamError still maps to 500", async () => {
  const adapter = fakeAdapter({
    listSessions: async () => {
      throw new Error("some other bug");
    },
  });
  const server = buildServer({ adapters: { event: adapter }, logger: false });
  const res = await server.inject({
    method: "GET",
    url: "/best?chain=event&movieId=m1&cinemaIds=c1&date=2026-07-21",
  });
  assert.equal(res.statusCode, 500);
});

// --- Gap 4: /cinemas route (injected stub adapter) --------------------------

test("/cinemas -> 200 + array of cinemas; unknown chain -> 400", async () => {
  const cinemas: Cinema[] = [
    { chain: "event", id: "58", name: "Event Cinemas Burwood", region: "NSW" },
    { chain: "event", id: "16", name: "Event Cinemas Bondi Junction", region: "NSW" },
  ];
  const server = buildServer({ adapters: { event: fakeAdapter({ cinemas }) }, logger: false });

  const ok = await server.inject({ method: "GET", url: "/cinemas?chain=event" });
  assert.equal(ok.statusCode, 200);
  const body = ok.json() as Cinema[];
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 2);
  assert.equal(body[0]!.chain, "event");
  assert.equal(typeof body[0]!.id, "string");
  assert.equal(body[0]!.name, "Event Cinemas Burwood");

  const bad = await server.inject({ method: "GET", url: "/cinemas?chain=nope" });
  assert.equal(bad.statusCode, 400);

  const missing = await server.inject({ method: "GET", url: "/cinemas" });
  assert.equal(missing.statusCode, 400);
});
