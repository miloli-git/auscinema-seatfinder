import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ReadingAdapter, type FetchJson } from "./index.js";

// Compiled test lives in dist/; fixtures are committed at ../fixtures relative to the package root.
function loadFixture(name: string): unknown {
  const url = new URL(`../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

/**
 * Route the injected fetcher by URL so a single adapter can satisfy the token bootstrap
 * (/settings) plus the data route under test — no network.
 */
function adapterRouting(routes: Record<string, string>): ReadingAdapter {
  const fetchJson: FetchJson = async (url) => {
    for (const [needle, fixture] of Object.entries(routes)) {
      if (url.includes(needle)) return loadFixture(fixture);
    }
    throw new Error(`no fixture for url: ${url}`);
  };
  return new ReadingAdapter({ fetchJson });
}

test("listCinemas: bootstraps token then normalises id(slug), name, region, url", async () => {
  const adapter = adapterRouting({
    "/settings/": "settings.json",
    getcinemas: "cinemas.json",
  });
  const cinemas = await adapter.listCinemas();

  assert.ok(cinemas.length >= 1);
  const auburn = cinemas.find((c) => c.id === "auburn");
  assert.ok(auburn, "auburn present");
  assert.equal(auburn.chain, "reading");
  assert.equal(auburn.name, "Auburn");
  assert.equal(auburn.region, "NSW");
  assert.equal(auburn.url, "https://readingcinemas.com.au/cinemas/auburn");
});

test("listSessions: filters per-cinema feed by movieId(ScheduledFilmId) + date, composites the id", async () => {
  const adapter = adapterRouting({
    "/settings/": "settings.json",
    films: "sessions.belmont.json",
  });
  const sessions = await adapter.listSessions({
    movieId: "HO00004380",
    cinemaIds: ["belmont"],
    date: "2026-06-25",
  });

  // 2 Standard + 1 Gold showtime, all the same Vista film id.
  assert.equal(sessions.length, 3);
  const first = sessions[0];
  assert.ok(first);
  assert.equal(first.chain, "reading");
  assert.equal(first.id, "belmont|190222|Standard|1"); // cinemaId|sessionId|screenType|reservedSeating
  assert.equal(first.movieId, "HO00004380");
  assert.equal(first.movieName, "Minions & Monsters");
  assert.equal(first.cinemaId, "belmont");
  assert.equal(first.startTime, "2026-06-25T10:00:00+08:00");
  assert.equal(first.format.kind, "standard");
  assert.equal(first.seatsAvailable, 304);
  assert.equal(first.seatAllocation, true);
  assert.equal(first.bookingUrl, "https://readingcinemas.com.au/sessions/190222/10143");

  // Gold showtime normalises to the "goldclass" bucket and carries its own composite id.
  const gold = sessions.find((s) => s.format.raw === "Gold");
  assert.ok(gold, "a Gold session present");
  assert.equal(gold.format.kind, "goldclass");
  assert.equal(gold.id, "belmont|190482|Gold|1");
});

test("listSessions: wrong movieId yields no sessions", async () => {
  const adapter = adapterRouting({
    "/settings/": "settings.json",
    films: "sessions.belmont.json",
  });
  const sessions = await adapter.listSessions({
    movieId: "HO99999999",
    cinemaIds: ["belmont"],
    date: "2026-06-25",
  });
  assert.equal(sessions.length, 0);
});

test("getSeatMap: maps all seat statuses, area, and negated grid geometry", async () => {
  const adapter = adapterRouting({
    "/settings/": "settings.json",
    tickettypes: "seats.belmont-190163.json",
  });
  // Session.id is the composite; getSeatMap decodes it to rebuild the seatPlan request.
  const map = await adapter.getSeatMap("belmont|190163|Premium|1");

  assert.equal(map.chain, "reading");
  assert.equal(map.sessionId, "belmont|190163|Premium|1");
  assert.ok(map.seats.length > 0, "expected seats");

  // Single standard area, keyed by Vista areaCategoryCode.
  assert.equal(map.areas.length, 1);
  const area = map.areas[0];
  assert.ok(area);
  assert.equal(area.id, "0000000002");
  assert.equal(area.kind, "standard");

  const byId = new Map(map.seats.filter((s) => s.id).map((s) => [s.id, s]));

  // A1: available "Empty" seat. Vista row 7 (front) -> core -7; column 20 -> core -20.
  const a1 = byId.get("A1");
  assert.ok(a1, "A1 present");
  assert.equal(a1.status, "available");
  assert.equal(a1.rowLabel, "A");
  assert.equal(a1.row, -7);
  assert.equal(a1.col, -20);
  assert.equal(a1.areaId, "0000000002");

  // Status vocabulary: Sold/Companion/Special/Broken all distinct.
  assert.equal(byId.get("F5")?.status, "sold"); // isBooked + seatType "Sold"
  assert.equal(byId.get("C5")?.status, "companion");
  assert.equal(byId.get("C6")?.status, "special");
  assert.equal(byId.get("D8")?.status, "unavailable"); // "Broken"

  // Higher core row = further back: F5 (Vista row 2 -> -2) sits behind A1 (-7).
  const f5 = byId.get("F5");
  assert.ok(f5);
  assert.ok(f5.row > a1.row, "row F further back than row A");

  // Aisles preserved as spacers so column geometry stays aligned.
  const spacers = map.seats.filter((s) => s.status === "spacer");
  assert.ok(spacers.length > 0, "aisles preserved as spacers");
});

test("getSeatMap: simple standard auditorium parses cleanly", async () => {
  const adapter = adapterRouting({
    "/settings/": "settings.json",
    tickettypes: "seats.auburn-128342.json",
  });
  const map = await adapter.getSeatMap("auburn|128342|Standard|1");
  assert.ok(map.seats.some((s) => s.status === "available"), "has available seats");
  assert.ok(map.seats.some((s) => s.status === "spacer"), "has aisle spacers");
  // Every non-spacer seat carries a label and an opaque id for the booking flow.
  for (const s of map.seats) {
    if (s.status === "spacer") continue;
    assert.ok(s.id, "seat has id");
    assert.ok(s.rowLabel, "seat has rowLabel");
  }
});
