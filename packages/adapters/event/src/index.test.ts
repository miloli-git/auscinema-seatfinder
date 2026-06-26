import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { UpstreamError } from "@auscinema/core";
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

const C8_QUERY = { movieId: "19797", date: "2026-07-21" } as const;

function sessionsPayload(
  cinemas: Array<{ id: string; name: string; sessionIds: string[] }>,
  opts: { movieId?: string; movieName?: string } = {},
): unknown {
  const movieId = opts.movieId ?? C8_QUERY.movieId;
  const movieName = opts.movieName ?? "C8 Movie";
  return {
    Success: true,
    Data: {
      Movies: [
        {
          Id: movieId,
          Name: movieName,
          CinemaModels: cinemas.map((cinema, cinemaIndex) => ({
            Id: cinema.id,
            Name: cinema.name,
            Sessions: cinema.sessionIds.map((id, sessionIndex) => ({
              Id: id,
              StartTime: `${C8_QUERY.date}T${String(10 + cinemaIndex).padStart(2, "0")}:${String(
                sessionIndex * 10,
              ).padStart(2, "0")}`,
              ScreenTypeName: "Standard",
              ScreenName: String(sessionIndex + 1),
              SeatAllocation: true,
              BookingUrl: `https://www.eventcinemas.com.au/Orders/Tickets#sessionId=${id}`,
            })),
          })),
        },
      ],
    },
  };
}

const EMPTY_SESSIONS_PAYLOAD = { Success: true, Data: { Movies: [] } };

function requestCinemaIds(urls: string[]): string[] {
  return urls.map((url) => {
    const value = new URL(url).searchParams.get("cinemaIds");
    if (value === null) throw new Error(`missing cinemaIds param in ${url}`);
    return value;
  });
}

function assertGetSessionsRequests(urls: string[], expectedCinemaIds: string[]): void {
  assert.deepEqual(requestCinemaIds(urls), expectedCinemaIds);
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    const expectedCinemaId = expectedCinemaIds[i];
    assert.ok(url, `missing request ${i}`);
    assert.ok(expectedCinemaId, `missing expected cinema ${i}`);
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://www.eventcinemas.com.au");
    assert.equal(parsed.pathname, "/Cinemas/GetSessions");
    assert.equal(parsed.searchParams.get("cinemaIds"), expectedCinemaId);
    assert.equal(parsed.searchParams.get("movieId"), C8_QUERY.movieId);
    assert.equal(parsed.searchParams.get("date"), C8_QUERY.date);
  }
  assert.equal(
    requestCinemaIds(urls).some((cinemaId) => cinemaId.includes(",")),
    false,
    "C8 forbids a comma-joined cinemaIds request",
  );
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
  // Row A starts with three spacers ("|0|11|20/19/18") - confirm they survive normalisation.
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

// --- default HTTP path: failures normalise to typed UpstreamError -----------

/** Run `fn` with globalThis.fetch swapped for `stub`, always restoring the original. */
async function withFetch(stub: typeof fetch, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("defaultFetchJson: non-2xx -> UpstreamError{kind:http,status}", async () => {
  const adapter = new EventCinemasAdapter(); // real default fetchJson
  let calls = 0;
  const stub = (async () => {
    calls += 1;
    return new Response("nope", { status: 502, statusText: "Bad Gateway" });
  }) as unknown as typeof fetch;
  await withFetch(stub, async () => {
    await assert.rejects(
      () => adapter.getSeatMap("15433720"),
      (err: unknown) => {
        assert.ok(err instanceof UpstreamError, "expected UpstreamError");
        assert.equal(err.kind, "http");
        assert.equal(err.status, 502);
        return true;
      },
    );
    assert.equal(calls, 1, "http errors should not be retried");
  });
});

test("defaultFetchJson: AbortError -> UpstreamError{kind:timeout}", async () => {
  const adapter = new EventCinemasAdapter();
  let calls = 0;
  const stub = (async () => {
    calls += 1;
    const e = new Error("aborted");
    e.name = "AbortError";
    throw e;
  }) as unknown as typeof fetch;
  await withFetch(stub, async () => {
    await assert.rejects(
      () => adapter.getSeatMap("15433720"),
      (err: unknown) => err instanceof UpstreamError && err.kind === "timeout",
    );
    assert.equal(calls, 2, "timeout errors should be retried once");
  });
});

test("defaultFetchJson: invalid JSON -> UpstreamError{kind:parse}", async () => {
  const adapter = new EventCinemasAdapter();
  let calls = 0;
  const stub = (async () => {
    calls += 1;
    return new Response("<html>not json</html>", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  await withFetch(stub, async () => {
    await assert.rejects(
      () => adapter.getSeatMap("15433720"),
      (err: unknown) => err instanceof UpstreamError && err.kind === "parse",
    );
    assert.equal(calls, 1, "parse errors should not be retried");
  });
});

test("defaultFetchJson: raw network error retries once before unknown", async () => {
  const adapter = new EventCinemasAdapter();
  let calls = 0;
  const stub = (async () => {
    calls += 1;
    throw new TypeError("socket closed");
  }) as unknown as typeof fetch;
  await withFetch(stub, async () => {
    await assert.rejects(
      () => adapter.getSeatMap("15433720"),
      (err: unknown) => err instanceof UpstreamError && err.kind === "unknown",
    );
    assert.equal(calls, 2, "raw network errors should be retried once");
  });
});

test("listCinemas: serves the bundled dated AU reference (>=40, incl Burwood=58)", async () => {
  const adapter = new EventCinemasAdapter();
  const cinemas = await adapter.listCinemas();
  assert.ok(cinemas.length >= 40, `expected >=40 cinemas, got ${cinemas.length}`);
  for (const c of cinemas) {
    assert.equal(c.chain, "event");
    assert.ok(c.id && /^\d+$/.test(c.id), `id should be numeric string, got "${c.id}"`);
    assert.ok(c.name.length > 0);
  }
  const burwood = cinemas.find((c) => c.id === "58");
  assert.ok(burwood, "Burwood (id 58) should be present");
  assert.equal(burwood?.name, "Burwood");
});

test("listSessions: filters to the requested movieId (Event ignores it server-side)", async () => {
  // Event's GetSessions returns ALL movies at the cinema regardless of the movieId param,
  // so the adapter must filter client-side. Synthetic two-movie payload.
  const twoMovies = {
    Success: true,
    Data: {
      Movies: [
        {
          Id: 100,
          Name: "Wanted Movie",
          CinemaModels: [
            { Id: 58, Name: "Burwood", Sessions: [{ Id: 1, StartTime: "2026-06-24T10:00", SeatAllocation: true }] },
          ],
        },
        {
          Id: 200,
          Name: "Other Movie",
          CinemaModels: [
            { Id: 58, Name: "Burwood", Sessions: [{ Id: 2, StartTime: "2026-06-24T11:00", SeatAllocation: true }] },
          ],
        },
      ],
    },
  };
  const adapter = new EventCinemasAdapter({ fetchJson: (async () => twoMovies) as FetchJson });

  const filtered = await adapter.listSessions({ movieId: "100", cinemaIds: ["58"], date: "2026-06-24" });
  assert.equal(filtered.length, 1, "should keep only the requested movie");
  assert.equal(filtered[0]?.movieId, "100");
  assert.equal(filtered[0]?.movieName, "Wanted Movie");

  const all = await adapter.listSessions({ movieId: "", cinemaIds: ["58"], date: "2026-06-24" });
  assert.equal(all.length, 2, "empty movieId returns all movies");
});

test("C8 listSessions: fans out one request per cinemaId and never comma-joins", async () => {
  // C8 declares: listSessions({ cinemaIds: string[] }) -> Session[]   // union, dedupe by session id
  const urls: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    urls.push(url);
    return EMPTY_SESSIONS_PAYLOAD;
  };
  const adapter = new EventCinemasAdapter({ fetchJson });

  await adapter.listSessions({ ...C8_QUERY, cinemaIds: ["15", "96"] });

  assertGetSessionsRequests(urls, ["15", "96"]);
});

test("C8 listSessions: returns the union of cinema sessions deduped by session id", async () => {
  const payload15 = sessionsPayload([{ id: "15", name: "George Street", sessionIds: ["shared-41", "15-only"] }]);
  const payload96 = sessionsPayload([{ id: "96", name: "Parramatta", sessionIds: ["shared-41", "96-only"] }]);
  const commaPayload = sessionsPayload([
    { id: "15", name: "George Street", sessionIds: ["shared-41", "15-only"] },
    { id: "96", name: "Parramatta", sessionIds: ["shared-41", "96-only"] },
  ]);
  const fetchJson: FetchJson = async (url) => {
    const cinemaIds = requestCinemaIds([url])[0];
    if (cinemaIds === "15") return payload15;
    if (cinemaIds === "96") return payload96;
    if (cinemaIds === "15,96") return commaPayload;
    return EMPTY_SESSIONS_PAYLOAD;
  };
  const adapter = new EventCinemasAdapter({ fetchJson });

  const sessions = await adapter.listSessions({ ...C8_QUERY, cinemaIds: ["15", "96"] });

  assert.deepEqual(
    sessions.map((session) => session.id).sort(),
    ["15-only", "96-only", "shared-41"],
  );
  assert.equal(sessions.filter((session) => session.id === "shared-41").length, 1);
  assert.equal(sessions.find((session) => session.id === "15-only")?.cinemaId, "15");
  assert.equal(sessions.find((session) => session.id === "96-only")?.cinemaId, "96");
});

test("C8 listSessions: single cinemaId still issues exactly one request", async () => {
  const urls: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    urls.push(url);
    return sessionsPayload([{ id: "15", name: "George Street", sessionIds: ["15-only"] }]);
  };
  const adapter = new EventCinemasAdapter({ fetchJson });

  const sessions = await adapter.listSessions({ ...C8_QUERY, cinemaIds: ["15"] });

  assertGetSessionsRequests(urls, ["15"]);
  assert.deepEqual(
    sessions.map((session) => session.id),
    ["15-only"],
  );
});

test("C8 listSessions: empty cinemaIds makes no request and returns an empty result", async () => {
  const urls: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    urls.push(url);
    return sessionsPayload([{ id: "unexpected", name: "Unexpected", sessionIds: ["unexpected"] }]);
  };
  const adapter = new EventCinemasAdapter({ fetchJson });

  const sessions = await adapter.listSessions({ ...C8_QUERY, cinemaIds: [] });

  assert.deepEqual(sessions, []);
  assert.deepEqual(urls, []);
});

test("C8 listSessions: propagates one per-cinema request failure without returning partial sessions", async () => {
  const urls: string[] = [];
  const failure = new UpstreamError("Event C8 cinema 96 failed", { kind: "http", status: 503 });
  const fetchJson: FetchJson = async (url) => {
    urls.push(url);
    const cinemaIds = requestCinemaIds([url])[0];
    if (cinemaIds === "15") {
      return sessionsPayload([{ id: "15", name: "George Street", sessionIds: ["15-only"] }]);
    }
    if (cinemaIds === "96") throw failure;
    return EMPTY_SESSIONS_PAYLOAD;
  };
  const adapter = new EventCinemasAdapter({ fetchJson });

  await assert.rejects(
    () => adapter.listSessions({ ...C8_QUERY, cinemaIds: ["15", "96"] }),
    (err: unknown) => {
      assert.equal(err, failure);
      return true;
    },
  );
  assertGetSessionsRequests(urls, ["15", "96"]);
});
