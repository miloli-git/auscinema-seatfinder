import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EventCinemasAdapter, type FetchJson } from "./index.js";

// Compiled test lives in dist/; fixtures are committed at ../fixtures relative to the package root.
function loadFixture(name: string): unknown {
  const url = new URL(`../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

/** Build an adapter whose fetchJson always returns the given parsed fixture (no network). */
function adapterReturning(fixture: unknown): EventCinemasAdapter {
  const fetchJson: FetchJson = async () => fixture;
  return new EventCinemasAdapter({ fetchJson });
}

test("getSeatMap: decodes seats, areas and preserves spacers", async () => {
  const adapter = adapterReturning(loadFixture("getseating.session-15433720.json"));
  const map = await adapter.getSeatMap("15433720");

  assert.equal(map.chain, "event");
  assert.equal(map.sessionId, "15433720");
  assert.ok(map.seats.length > 0, "expected seats");

  // Areas mapped: Double Daybed -> daybed, Full Recliner -> recliner, Standard -> standard.
  const byName = new Map(map.areas.map((a) => [a.name, a]));
  assert.equal(byName.get("Double Daybed")?.kind, "daybed");
  assert.equal(byName.get("Full Recliner")?.kind, "recliner");
  assert.equal(byName.get("Standard")?.kind, "standard");

  // Seat "A1": Available, premium couple seat, SeatId "0000000004|2|11|17".
  const a1 = map.seats.find((s) => s.name === "A1");
  assert.ok(a1, "A1 present");
  assert.equal(a1.status, "available");
  assert.equal(a1.rowLabel, "A");
  assert.equal(a1.id, "0000000004|2|11|17");
  assert.equal(a1.row, -11); // physRow 11 negated -> front-most row
  assert.equal(a1.col, -17); // physCol 17 negated -> increases left->right
  assert.equal(a1.paired, true);
  assert.equal(a1.premium, true);
  assert.equal(a1.areaId, "5");

  // Higher row = further back: row K (physRow 1 -> -1) sits behind row A (-11).
  const k = map.seats.find((s) => s.rowLabel === "K");
  assert.ok(k);
  assert.ok(k.row > a1.row, "row K is further back than row A");

  // Spacers preserved as status "spacer" (not dropped).
  const spacers = map.seats.filter((s) => s.status === "spacer");
  assert.ok(spacers.length > 0, "spacers preserved");
  // Row A starts with three spacers ("|0|11|20/19/18") — confirm they survive normalisation.
  assert.ok(spacers.some((s) => s.id === "|0|11|20"), "row-A spacer preserved");

  // Wheelchair "Special" seat mapped to accessible + special status.
  const c5 = map.seats.find((s) => s.name === "C5");
  assert.ok(c5);
  assert.equal(c5.status, "special");
  assert.equal(c5.accessible, true);
});

test("listSessions: maps cinema 58 sessions with ids, times and format", async () => {
  const adapter = adapterReturning(loadFixture("getsessions.burwood.odyssey.json"));
  const sessions = await adapter.listSessions({
    movieId: "19797",
    cinemaIds: ["58"],
    date: "2026-07-21",
  });

  assert.equal(sessions.length, 8);
  const ids = sessions.map((s) => s.id);
  assert.deepEqual(ids, [
    "15433720",
    "15433719",
    "15433721",
    "15433718",
    "15433723",
    "15433717",
    "15433722",
    "15433716",
  ]);

  const first = sessions[0];
  assert.ok(first);
  assert.equal(first.chain, "event");
  assert.equal(first.movieId, "19797");
  assert.equal(first.movieName, "The Odyssey");
  assert.equal(first.cinemaId, "58");
  assert.equal(first.cinemaName, "Burwood");
  assert.equal(first.startTime, "2026-07-21T09:30");
  assert.equal(first.format.kind, "vmax");
  assert.equal(first.format.raw, "V-Max");
  assert.equal(first.screenName, "7");
  assert.equal(first.seatsAvailable, 156);
  assert.equal(first.seatAllocation, true);
  assert.equal(first.bookingUrl, "https://www.eventcinemas.com.au/Orders/Tickets#sessionId=15433720");
  assert.ok(first.attributes?.includes("NFT"));
});
