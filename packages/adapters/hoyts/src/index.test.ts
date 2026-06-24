import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HoytsAdapter, type FetchJson } from "./index.js";

// Compiled test lives in dist/; fixtures are committed at ../fixtures relative to the package root.
function loadFixture(name: string): unknown {
  const url = new URL(`../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

/** Build an adapter whose fetchJson always returns the given parsed fixture (no network). */
function adapterReturning(fixture: unknown): HoytsAdapter {
  const fetchJson: FetchJson = async () => fixture;
  return new HoytsAdapter({ fetchJson });
}

test("getSeatMap: decodes daybed groups, areas, index geometry and spacers", async () => {
  const adapter = adapterReturning(loadFixture("seats.midcin-58337.json"));
  // Session.id is "cinemaId:sessionId"; the seat route splits it back.
  const map = await adapter.getSeatMap("MIDCIN:58337");

  assert.equal(map.chain, "hoyts");
  assert.equal(map.sessionId, "MIDCIN:58337");
  assert.ok(map.seats.length > 0, "expected seats");

  // Areas: Daybed -> daybed, Recliner -> recliner.
  const byName = new Map(map.areas.map((a) => [a.name, a]));
  assert.equal(byName.get("Daybed")?.kind, "daybed");
  assert.equal(byName.get("Recliner")?.kind, "recliner");

  // Seat "A10": front row (index 0), first column, paired daybed.
  const a10 = map.seats.find((s) => s.name === "A10");
  assert.ok(a10, "A10 present");
  assert.equal(a10.id, "13");
  assert.equal(a10.rowLabel, "A");
  assert.equal(a10.row, 0); // first row = front-most
  assert.equal(a10.col, 0); // first slot left->right
  assert.equal(a10.status, "available");
  assert.equal(a10.areaId, "2");
  assert.equal(a10.paired, true);

  // Its grouped partner "A9" sits in the next column.
  const a9 = map.seats.find((s) => s.name === "A9");
  assert.ok(a9);
  assert.equal(a9.col, 1);
  assert.equal(a9.paired, true);

  // Higher row index = further back: a "B"-row seat sits behind an "A"-row seat.
  const b = map.seats.find((s) => s.rowLabel === "B");
  assert.ok(b);
  assert.ok(b.row > a10.row, "row B is further back than row A");

  // Wheelchair seat flagged accessible.
  const wc = map.seats.find((s) => s.accessible === true);
  assert.ok(wc, "wheelchair seat present");
  assert.equal(wc.rowLabel, "B");

  // Structural gaps preserved as spacers so column geometry stays aligned.
  const spacers = map.seats.filter((s) => s.status === "spacer");
  assert.ok(spacers.length > 0, "spacers preserved");
});

test("getSeatMap: maps sold seats and front->back row indices", async () => {
  const adapter = adapterReturning(loadFixture("seats.broadw-456373.json"));
  const map = await adapter.getSeatMap("BROADW:456373");

  // C1 / C2 are sold recliners.
  const c1 = map.seats.find((s) => s.name === "C1");
  assert.ok(c1);
  assert.equal(c1.status, "sold");
  assert.equal(c1.areaId, "1");
  assert.equal(c1.paired, false);

  // Rows go A(0), ""(1 spacer-row), B(2), ""(3), C(4): row C is further back than row A.
  const a = map.seats.find((s) => s.rowLabel === "A");
  assert.ok(a);
  assert.ok(c1.row > a.row, "row C further back than row A");
});

test("listSessions: filters per-cinema feed by movieId + date, composites the id", async () => {
  const adapter = adapterReturning(loadFixture("sessions.midcin.json"));
  const sessions = await adapter.listSessions({
    movieId: "HO00008574",
    cinemaIds: ["MIDCIN"],
    date: "2026-06-24",
  });

  assert.equal(sessions.length, 8);
  const first = sessions[0];
  assert.ok(first);
  assert.equal(first.chain, "hoyts");
  assert.equal(first.id, "MIDCIN:58340"); // cinemaId:sessionId composite
  assert.equal(first.movieId, "HO00008574");
  assert.equal(first.cinemaId, "MIDCIN");
  assert.equal(first.startTime, "2026-06-24T10:30:00");
  assert.equal(first.format.kind, "other"); // XTREME -> no core bucket
  assert.equal(first.format.raw, "XTREME");
  assert.equal(first.screenName, "Xtremescreen 02");
  assert.equal(first.seatAllocation, true);
  assert.equal(first.bookingUrl, "https://www.hoyts.com.au/orders/tickets?cinemaId=MIDCIN&sessionId=58340");
  assert.ok(first.attributes?.includes("XTREME"));

  // LUX sessions normalise to the "premium" bucket.
  const lux = sessions.find((s) => s.format.raw === "LUX");
  assert.ok(lux, "a LUX session present");
  assert.equal(lux.format.kind, "premium");

  // STANDARD sessions normalise to "standard".
  const std = sessions.find((s) => s.format.raw === "STANDARD");
  assert.ok(std);
  assert.equal(std.format.kind, "standard");
});

test("listSessions: wrong movieId yields no sessions", async () => {
  const adapter = adapterReturning(loadFixture("sessions.midcin.json"));
  const sessions = await adapter.listSessions({
    movieId: "HO99999999",
    cinemaIds: ["MIDCIN"],
    date: "2026-06-24",
  });
  assert.equal(sessions.length, 0);
});

test("listCinemas: normalises id, name, region and url", async () => {
  const adapter = adapterReturning(loadFixture("cinemas.json"));
  const cinemas = await adapter.listCinemas();

  assert.ok(cinemas.length >= 1);
  const mid = cinemas.find((c) => c.id === "MIDCIN");
  assert.ok(mid, "MIDCIN present");
  assert.equal(mid.chain, "hoyts");
  assert.equal(mid.name, "ACE HOYTS Midland Gate");
  assert.equal(mid.region, "WA");
  assert.equal(mid.url, "https://www.hoyts.com.au/cinemas/midland-gate");
});
