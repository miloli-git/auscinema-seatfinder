import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EventCinemasAdapter, type FetchJson } from "@auscinema/adapter-event";
import { buildServer } from "./index.js";

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
