import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ChainAdapter,
  Cinema,
  SeatMap,
  Session,
  SessionQuery,
  Seat,
} from "@auscinema/core";
import { runCheck } from "./check.js";
import { inTimeWindow } from "./check.js";
import { WatchState } from "./state.js";
import type { Notifier, Hit } from "./notifier.js";
import type { AdapterRegistry } from "./registry.js";
import type { Watch, WatcherConfig } from "./config.js";

// --- Stubs ------------------------------------------------------------------

function seat(id: string, name: string, row: number, col: number, status: Seat["status"] = "available"): Seat {
  return { id, name, rowLabel: name[0] ?? "A", row, col, status, areaId: "1" };
}

function session(id: string, startTime: string, seatAllocation = true): Session {
  return {
    chain: "event",
    id,
    movieId: "M1",
    movieName: "Test",
    cinemaId: "C1",
    cinemaName: "Test Cinema",
    startTime,
    format: { kind: "standard", raw: "STANDARD" },
    seatAllocation,
    bookingUrl: `https://book.example/${id}`,
  };
}

/** Adapter stub: fixed sessions + a per-sessionId seat map. */
function stubAdapter(sessions: Session[], maps: Record<string, SeatMap>): ChainAdapter {
  return {
    chain: "event",
    async listCinemas(): Promise<Cinema[]> {
      return [];
    },
    async listSessions(_q: SessionQuery): Promise<Session[]> {
      return sessions;
    },
    async getSeatMap(sessionId: string): Promise<SeatMap> {
      const m = maps[sessionId];
      if (!m) throw new Error(`no map for ${sessionId}`);
      return m;
    },
  };
}

/** Notifier stub capturing every batch it is handed. */
class CapturingNotifier implements Notifier {
  readonly calls: Hit[][] = [];
  async notify(hits: Hit[]): Promise<void> {
    this.calls.push(hits);
  }
}

function watch(overrides: Partial<Watch> = {}): Watch {
  return {
    id: "w1",
    chain: "event",
    movieId: "M1",
    cinemaIds: ["C1"],
    date: "2026-07-21",
    preference: {},
    minScore: 60,
    label: "Test watch",
    ...overrides,
  };
}

function configOf(w: Watch): WatcherConfig {
  return { watches: [w], concurrency: 2 };
}

// A central, mid-depth seat scores high; an extreme front-corner seat scores low.
// Geometry: rows 0..4, cols 0..4. Target depth 0.65, balanced weights.
function mapWith(seats: Seat[]): SeatMap {
  return {
    chain: "event",
    sessionId: "S1",
    areas: [{ id: "1", name: "Stalls", kind: "standard" }],
    seats,
  };
}

// Fill a 5x5 grid so geometry (min/max row+col) is well-defined.
function grid(extra: Seat[] = []): Seat[] {
  const seats: Seat[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      seats.push(seat(`g${r}${c}`, `${String.fromCharCode(65 + r)}${c + 1}`, r, c, "sold"));
    }
  }
  return [...seats, ...extra];
}

// --- Tests ------------------------------------------------------------------

test("a seat above minScore triggers exactly one notification", async () => {
  // Central, mid-depth available seat (row 3, col 2) inside a 5x5 grid → high score.
  const good = seat("good", "D3", 3, 2, "available");
  const maps = { S1: mapWith(grid([good])) };
  const adapter = stubAdapter([session("S1", "2026-07-21T19:30")], maps);
  const registry: AdapterRegistry = { event: adapter };
  const notifier = new CapturingNotifier();
  const state = new WatchState();

  const res = await runCheck(configOf(watch()), { registry, notifier, state });

  assert.equal(notifier.calls.length, 1, "notifier called exactly once");
  assert.equal(res.newHits.length, 1);
  const hit = res.newHits[0]!;
  assert.equal(hit.seatId, "good");
  assert.equal(hit.bookingUrl, "https://book.example/S1");
  assert.ok(hit.score >= 60, `score ${hit.score} >= minScore`);
});

test("a second check with unchanged state does NOT re-notify (de-dupe)", async () => {
  const good = seat("good", "D3", 3, 2, "available");
  const maps = { S1: mapWith(grid([good])) };
  const adapter = stubAdapter([session("S1", "2026-07-21T19:30")], maps);
  const registry: AdapterRegistry = { event: adapter };
  const notifier = new CapturingNotifier();
  const state = new WatchState();

  const first = await runCheck(configOf(watch()), { registry, notifier, state });
  assert.equal(first.newHits.length, 1);

  const second = await runCheck(configOf(watch()), { registry, notifier, state });
  assert.equal(second.hits.length, 1, "seat still found");
  assert.equal(second.newHits.length, 0, "but not re-alerted");
  assert.equal(notifier.calls.length, 1, "notifier still only called once total");
});

test("seats below threshold or sold do not notify", async () => {
  // Front-corner available seat (row 0, col 0) scores low; everything else sold.
  const corner = seat("corner", "A1", 0, 0, "available");
  const maps = { S1: mapWith(grid([corner])) };
  const adapter = stubAdapter([session("S1", "2026-07-21T19:30")], maps);
  const registry: AdapterRegistry = { event: adapter };
  const notifier = new CapturingNotifier();
  const state = new WatchState();

  const res = await runCheck(configOf(watch({ minScore: 90 })), { registry, notifier, state });

  assert.equal(res.hits.length, 0, "no above-threshold available seat");
  assert.equal(res.newHits.length, 0);
  assert.equal(notifier.calls.length, 0, "notifier not called");
});

test("timeWindow filtering excludes out-of-window sessions", async () => {
  const good = seat("good", "D3", 3, 2, "available");
  // Two sessions: 10:30 (out of window) and 19:30 (in window). Both have the good seat.
  const maps: Record<string, SeatMap> = {
    Smorning: { ...mapWith(grid([good])), sessionId: "Smorning" },
    Sevening: { ...mapWith(grid([good])), sessionId: "Sevening" },
  };
  const adapter = stubAdapter(
    [session("Smorning", "2026-07-21T10:30"), session("Sevening", "2026-07-21T19:30")],
    maps,
  );
  const registry: AdapterRegistry = { event: adapter };
  const notifier = new CapturingNotifier();
  const state = new WatchState();

  const res = await runCheck(
    configOf(watch({ timeWindow: { from: "17:00", to: "23:00" } })),
    { registry, notifier, state },
  );

  assert.equal(res.hits.length, 1, "only the in-window session contributes a hit");
  assert.equal(res.newHits[0]!.sessionId, "Sevening");
});

test("inTimeWindow: boundaries inclusive, missing window passes", () => {
  assert.equal(inTimeWindow("2026-07-21T17:00", { from: "17:00", to: "23:00" }), true);
  assert.equal(inTimeWindow("2026-07-21T23:00", { from: "17:00", to: "23:00" }), true);
  assert.equal(inTimeWindow("2026-07-21T16:59", { from: "17:00", to: "23:00" }), false);
  assert.equal(inTimeWindow("2026-07-21T19:30", undefined), true);
});

test("a cleared seat re-alerts after reopening", async () => {
  const good = seat("good", "D3", 3, 2, "available");
  const openMaps = { S1: mapWith(grid([good])) };
  const soldMaps = { S1: mapWith(grid([seat("good", "D3", 3, 2, "sold")])) };

  const registry = (maps: Record<string, SeatMap>): AdapterRegistry => ({
    event: stubAdapter([session("S1", "2026-07-21T19:30")], maps),
  });
  const notifier = new CapturingNotifier();
  const state = new WatchState();

  // Open → alert.
  const r1 = await runCheck(configOf(watch()), { registry: registry(openMaps), notifier, state });
  assert.equal(r1.newHits.length, 1);

  // Sold → pruned from state (no hit).
  const r2 = await runCheck(configOf(watch()), { registry: registry(soldMaps), notifier, state });
  assert.equal(r2.newHits.length, 0);
  assert.equal(r2.hits.length, 0);

  // Reopened → alerts again because state was cleared.
  const r3 = await runCheck(configOf(watch()), { registry: registry(openMaps), notifier, state });
  assert.equal(r3.newHits.length, 1, "re-alerts after reopen");
  assert.equal(notifier.calls.length, 2);
});
