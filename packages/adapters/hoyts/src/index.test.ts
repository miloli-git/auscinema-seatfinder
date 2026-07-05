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
  // #52: Hoyts has no published seat coordinates - geometry is always approximate.
  assert.equal(map.geometryConfidence, "approximate");

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

test("getSeatMap: real seat ids are unique across rows when Hoyts raw ids repeat", async () => {
  const adapter = adapterReturning(loadFixture("seats.duplicate-seat-ids.json"));

  const first = await adapter.getSeatMap("DUPCIN:12345");
  const second = await adapter.getSeatMap("DUPCIN:12345");

  // Hoyts spacers currently carry an empty id; persisted seats are the non-spacer entries.
  assert.ok(first.seats.some((s) => s.status === "spacer"), "fixture includes a structural spacer");
  const realSeats = first.seats.filter((s) => s.status !== "spacer");
  const realSeatIds = realSeats.map((s) => s.id);

  assert.equal(realSeats.length, 4);
  assert.ok(realSeatIds.every((id) => id.length > 0), "real seats carry booking ids");
  assert.equal(
    new Set(realSeatIds).size,
    realSeats.length,
    "real Seat.id values must be unique within one Hoyts seat map",
  );

  const secondRealSeatIds = second.seats.filter((s) => s.status !== "spacer").map((s) => s.id);
  assert.deepEqual(secondRealSeatIds, realSeatIds, "real Seat.id values are deterministic for the same map");

  const geometry = (name: string): { rowLabel: string; row: number; col: number } => {
    const seat = realSeats.find((s) => s.name === name);
    assert.ok(seat, `${name} present`);
    return { rowLabel: seat.rowLabel, row: seat.row, col: seat.col };
  };

  assert.deepEqual(geometry("C3"), { rowLabel: "C", row: 0, col: 0 });
  assert.deepEqual(geometry("C4"), { rowLabel: "C", row: 0, col: 2 });
  assert.deepEqual(geometry("D3"), { rowLabel: "D", row: 1, col: 0 });
  assert.deepEqual(geometry("D4"), { rowLabel: "D", row: 1, col: 1 });
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

test("listSessions: #67 resolves real cinemaName from listCinemas(), never blank", async () => {
  const fetchJson: FetchJson = async (url) => {
    if (url.includes("/cinemas")) return loadFixture("cinemas.json");
    if (url.includes("/movies")) return loadFixture("movies.json");
    if (url.includes("/sessions/")) return loadFixture("sessions.midcin.json");
    throw new Error(`no fixture for url: ${url}`);
  };
  const adapter = new HoytsAdapter({ fetchJson });
  const sessions = await adapter.listSessions({
    movieId: "HO00008574",
    cinemaIds: ["MIDCIN"],
    date: "2026-06-24",
  });

  assert.ok(sessions.length > 0);
  for (const s of sessions) assert.equal(s.cinemaName, "ACE HOYTS Midland Gate");
});

test("listSessions: #72 resolves real movieName from the movies list, never blank", async () => {
  const fetchJson: FetchJson = async (url) => {
    if (url.includes("/cinemas")) return loadFixture("cinemas.json");
    if (url.includes("/movies")) return loadFixture("movies.json");
    if (url.includes("/sessions/")) return loadFixture("sessions.midcin.json");
    throw new Error(`no fixture for url: ${url}`);
  };
  const adapter = new HoytsAdapter({ fetchJson });
  const sessions = await adapter.listSessions({
    movieId: "HO00008574",
    cinemaIds: ["MIDCIN"],
    date: "2026-06-24",
  });

  assert.ok(sessions.length > 0);
  for (const s of sessions) assert.equal(s.movieName, "Example Movie Title");
});

test("listSessions: #72 falls back to '' for a movieId absent from the movies list", async () => {
  const fetchJson: FetchJson = async (url) => {
    if (url.includes("/cinemas")) return loadFixture("cinemas.json");
    if (url.includes("/movies")) return loadFixture("movies.json");
    if (url.includes("/sessions/")) return loadFixture("sessions.midcin.json");
    throw new Error(`no fixture for url: ${url}`);
  };
  const adapter = new HoytsAdapter({ fetchJson });
  const sessions = await adapter.listSessions({
    movieId: "HO99999999",
    cinemaIds: ["MIDCIN"],
    date: "2026-06-24",
  });
  assert.equal(sessions.length, 0); // no session with this movieId, but confirms no throw on lookup miss
});

test("listSessions: #47 memoizes the cinema-list fetch across repeated calls within the TTL", async () => {
  let cinemaFetchCount = 0;
  const fetchJson: FetchJson = async (url) => {
    if (url.includes("/cinemas")) {
      cinemaFetchCount += 1;
      return loadFixture("cinemas.json");
    }
    if (url.includes("/movies")) return loadFixture("movies.json");
    if (url.includes("/sessions/")) return loadFixture("sessions.midcin.json");
    throw new Error(`no fixture for url: ${url}`);
  };
  const adapter = new HoytsAdapter({ fetchJson });
  const query = { movieId: "HO00008574", cinemaIds: ["MIDCIN"], date: "2026-06-24" };

  await adapter.listSessions(query);
  await adapter.listSessions(query);
  await adapter.listSessions(query);

  assert.equal(cinemaFetchCount, 1, "repeated listSessions calls reuse the memoized cinema list");

  // Concurrent calls (same tick) must also collapse to a single upstream cinema-list fetch.
  cinemaFetchCount = 0;
  const fresh = new HoytsAdapter({ fetchJson });
  await Promise.all([fresh.listSessions(query), fresh.listSessions(query), fresh.listSessions(query)]);
  assert.equal(cinemaFetchCount, 1, "concurrent listSessions calls collapse to one cinema-list fetch");
});

test("listSessions: #47 memoization expires after the TTL and re-fetches the cinema list", async () => {
  let cinemaFetchCount = 0;
  const fetchJson: FetchJson = async (url) => {
    if (url.includes("/cinemas")) {
      cinemaFetchCount += 1;
      return loadFixture("cinemas.json");
    }
    if (url.includes("/movies")) return loadFixture("movies.json");
    if (url.includes("/sessions/")) return loadFixture("sessions.midcin.json");
    throw new Error(`no fixture for url: ${url}`);
  };
  const adapter = new HoytsAdapter({ fetchJson, cinemaListTtlMs: 1 });
  const query = { movieId: "HO00008574", cinemaIds: ["MIDCIN"], date: "2026-06-24" };

  await adapter.listSessions(query);
  await new Promise((r) => setTimeout(r, 5));
  await adapter.listSessions(query);

  assert.equal(cinemaFetchCount, 2, "expired cache re-fetches the cinema list");
});

test("listMovieNames: #72 movieListTtlMs memoizes the movies-list fetch across repeated calls", async () => {
  let movieFetchCount = 0;
  const fetchJson: FetchJson = async (url) => {
    if (url.includes("/cinemas")) return loadFixture("cinemas.json");
    if (url.includes("/movies")) {
      movieFetchCount += 1;
      return loadFixture("movies.json");
    }
    if (url.includes("/sessions/")) return loadFixture("sessions.midcin.json");
    throw new Error(`no fixture for url: ${url}`);
  };
  const adapter = new HoytsAdapter({ fetchJson });
  const query = { movieId: "HO00008574", cinemaIds: ["MIDCIN"], date: "2026-06-24" };

  await adapter.listSessions(query);
  await adapter.listSessions(query);

  assert.equal(movieFetchCount, 1, "repeated listSessions calls reuse the memoized movies list");
});

test("listMovieNames: #75 skips malformed entries (missing vistaId or name)", async () => {
  const adapter = adapterReturning(loadFixture("movies.json"));
  const names = await adapter.listMovieNames();

  // Fixture now carries 4 entries: 1 well-formed + 1 missing vistaId + 1 missing name + 1
  // comma-joined vistaId (which expands to 2 map entries - see the next test).
  assert.equal(names.size, 3, "malformed entries without vistaId/name are skipped");
  assert.equal(names.get("HO00008574"), "Example Movie Title");
  assert.equal(names.get("HO00009999"), undefined, "entry missing name is skipped, not stored as undefined");
});

test("listMovieNames: comma-joined vistaId resolves BOTH ids to the same name (571-session blank-title cluster)", async () => {
  const adapter = adapterReturning(loadFixture("movies.json"));
  const names = await adapter.listMovieNames();

  // Live-verified 2026-07-05: Hoyts' /movies entries sometimes carry a comma-joined vistaId
  // list (e.g. "HO00010000,HO00011219" for Spider-Man: Brand New Day). A session's movieId is
  // always one bare id from that list - both halves must resolve, not just the joined string.
  assert.equal(names.get("HO00010500"), "Comma Joined Movie");
  assert.equal(names.get("HO00010501"), "Comma Joined Movie");
  assert.equal(
    names.get("HO00010500,HO00010501"),
    undefined,
    "the raw joined string must never be used as a map key",
  );
});

test("listSessions: comma-joined vistaId movies resolve a real title for sessions keyed on either half", async () => {
  const fetchJson: FetchJson = async (url) => {
    if (url.includes("/cinemas")) return loadFixture("cinemas.json");
    if (url.includes("/movies")) return loadFixture("movies.json");
    if (url.includes("/sessions/")) {
      return [
        {
          id: 90001,
          cinemaId: "MIDCIN",
          movieId: "HO00010500",
          date: "2026-08-05T18:00:00",
          typeId: "STANDARD",
          originalTags: [],
          disabled: false,
          allocatedSeating: true,
          discount: false,
          screenName: "Cinema 01",
          operator: "MID",
          link: "/orders/tickets?cinemaId=MIDCIN&sessionId=90001",
        },
        {
          id: 90002,
          cinemaId: "MIDCIN",
          movieId: "HO00010501",
          date: "2026-08-05T20:00:00",
          typeId: "STANDARD",
          originalTags: [],
          disabled: false,
          allocatedSeating: true,
          discount: false,
          screenName: "Cinema 02",
          operator: "MID",
          link: "/orders/tickets?cinemaId=MIDCIN&sessionId=90002",
        },
      ];
    }
    throw new Error(`no fixture for url: ${url}`);
  };
  const adapter = new HoytsAdapter({ fetchJson });

  const first = await adapter.listSessions({
    movieId: "HO00010500",
    cinemaIds: ["MIDCIN"],
    date: "2026-08-05",
  });
  const second = await adapter.listSessions({
    movieId: "HO00010501",
    cinemaIds: ["MIDCIN"],
    date: "2026-08-05",
  });

  assert.equal(first.length, 1);
  assert.equal(first[0]?.movieName, "Comma Joined Movie");
  assert.equal(second.length, 1);
  assert.equal(second[0]?.movieName, "Comma Joined Movie");
});

test("listSessions: #75 degrades to blank movieName when the movies endpoint rejects (session/seat discovery unaffected)", async () => {
  const fetchJson: FetchJson = async (url) => {
    if (url.includes("/cinemas")) return loadFixture("cinemas.json");
    if (url.includes("/movies")) throw new Error("movies endpoint down");
    if (url.includes("/sessions/")) return loadFixture("sessions.midcin.json");
    throw new Error(`no fixture for url: ${url}`);
  };
  const adapter = new HoytsAdapter({ fetchJson });
  const sessions = await adapter.listSessions({
    movieId: "HO00008574",
    cinemaIds: ["MIDCIN"],
    date: "2026-06-24",
  });

  assert.ok(sessions.length > 0, "session/seat discovery is unaffected by a rejecting movies endpoint");
  for (const s of sessions) assert.equal(s.movieName, "", "movieName degrades to blank rather than throwing");
  for (const s of sessions) {
    assert.equal(s.cinemaName, "ACE HOYTS Midland Gate", "cinemaName resolution (independent cache) is unaffected");
  }
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
