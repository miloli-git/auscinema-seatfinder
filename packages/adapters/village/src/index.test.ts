import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VillageAdapter, type FetchJson } from "./index.js";

// Compiled test lives in dist/; fixtures are committed at ../fixtures relative to the package root.
function loadFixture(name: string): unknown {
  const url = new URL(`../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

/** Route the injected fetcher by URL so one adapter serves whichever feed the test exercises. */
function adapterRouting(routes: Record<string, string>): VillageAdapter {
  const fetchJson: FetchJson = async (url) => {
    for (const [needle, fixture] of Object.entries(routes)) {
      if (url.includes(needle)) return loadFixture(fixture);
    }
    throw new Error(`no fixture for url: ${url}`);
  };
  return new VillageAdapter({ fetchJson });
}

test("listCinemas: dedupes the cinema objects out of the hits feed", async () => {
  const adapter = adapterRouting({ "algolia/sessions/hits": "sessions.json" });
  const cinemas = await adapter.listCinemas();

  // sessions.json carries hits for two cinemas (027 Albury, 272 Airport West).
  assert.equal(cinemas.length, 2);
  const albury = cinemas.find((c) => c.id === "027");
  assert.ok(albury, "Albury present");
  assert.equal(albury.chain, "village");
  assert.equal(albury.name, "Albury");
  assert.equal(albury.region, "NSW");
  assert.equal(albury.url, "https://villagecinemas.com.au/order/tickets?cinemaId=027");
});

test("listSessions: parses Algolia hits, composites the id, normalises time + allocation", async () => {
  const adapter = adapterRouting({ "algolia/sessions/hits": "sessions.json" });
  const sessions = await adapter.listSessions({
    movieId: "HO00016727",
    cinemaIds: ["027", "272"],
    date: "2026-06-24",
  });

  assert.equal(sessions.length, 5);
  const s = sessions.find((x) => x.id === "272|402548");
  assert.ok(s, "session 272|402548 present");
  assert.equal(s.chain, "village");
  assert.equal(s.movieId, "HO00016727");
  assert.equal(s.movieName, "Backrooms");
  assert.equal(s.cinemaId, "272");
  assert.equal(s.cinemaName, "Airport West");
  assert.equal(s.startTime, "2026-06-24T16:00:00+10:00"); // microseconds stripped, offset kept
  assert.equal(s.format.kind, "standard");
  assert.equal(s.seatsAvailable, 114);
  assert.equal(s.seatAllocation, false);
  assert.equal(
    s.bookingUrl,
    "https://villagecinemas.com.au/order/tickets?cinemaId=272&sessionId=402548",
  );

  // An allocated-seating session from the other cinema carries its own composite id.
  const alloc = sessions.find((x) => x.id === "027|400853");
  assert.ok(alloc, "allocated session present");
  assert.equal(alloc.seatAllocation, true);
});

test("listSessions: wrong movieId yields no sessions (defensive client-side filter)", async () => {
  const adapter = adapterRouting({ "algolia/sessions/hits": "sessions.json" });
  const sessions = await adapter.listSessions({
    movieId: "HO99999999",
    cinemaIds: ["027"],
    date: "2026-06-24",
  });
  assert.equal(sessions.length, 0);
});

test("getSeatMap: maps status vocabulary, area, and negated grid geometry", async () => {
  const adapter = adapterRouting({ "session/seat-map": "seats.albury-400853.json" });
  // Session.id is the composite; getSeatMap decodes it to rebuild the seat-route request.
  const map = await adapter.getSeatMap("027|400853");

  assert.equal(map.chain, "village");
  assert.equal(map.sessionId, "027|400853");
  assert.ok(map.seats.length > 0, "expected seats");

  // Single standard area, keyed by Vista areaCategoryCode.
  assert.equal(map.areas.length, 1);
  const area = map.areas[0];
  assert.ok(area);
  assert.equal(area.id, "0000000001");
  assert.equal(area.kind, "standard");

  const byId = new Map(map.seats.filter((s) => s.id).map((s) => [s.id, s]));

  // A1: available seat. Vista position row 6 (front) -> core -6; column 15 -> core -15.
  const a1 = byId.get("A1");
  assert.ok(a1, "A1 present");
  assert.equal(a1.status, "available");
  assert.equal(a1.rowLabel, "A");
  assert.equal(a1.row, -6);
  assert.equal(a1.col, -15);
  assert.equal(a1.areaId, "0000000001");

  // A5 is a booked real seat (seatStatus "unavailable") -> sold.
  assert.equal(byId.get("A5")?.status, "sold");

  // Structural empties (status -1, empty seatId) preserved as spacers to keep columns aligned.
  const spacers = map.seats.filter((s) => s.status === "spacer");
  assert.ok(spacers.length > 0, "aisle/empty cells preserved as spacers");
  assert.ok(
    spacers.every((s) => s.id === ""),
    "spacers carry no booking id",
  );

  // Higher core row = further back: a back-row seat sits behind A1.
  const backRow = [...byId.values()].find((s) => s.row > a1.row);
  assert.ok(backRow, "a seat further back than row A exists");
});

test("getSeatMap: a second auditorium (different cinema/screen) parses cleanly", async () => {
  const adapter = adapterRouting({ "session/seat-map": "seats.vpremium-329077.json" });
  const map = await adapter.getSeatMap("351|329077");
  assert.ok(map.seats.some((s) => s.status === "available"), "has available seats");
  assert.ok(map.seats.some((s) => s.status === "spacer"), "has spacer cells");
  // Every non-spacer seat carries a label and an opaque id for the booking flow.
  for (const s of map.seats) {
    if (s.status === "spacer") continue;
    assert.ok(s.id, "seat has id");
    assert.ok(s.rowLabel, "seat has rowLabel");
  }
});
