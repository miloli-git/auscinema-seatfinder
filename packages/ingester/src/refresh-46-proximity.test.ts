import { test } from "node:test";
import assert from "node:assert/strict";
import { selectDueSessions, type KnownSession } from "./index.js";

/**
 * #46 fix regression tests: proximity-weighted T2 due-selection (item 2) and reserved-new-lane
 * horizon-edge exclusion (item 3a). RCA: seatfinder.miloli.org served a session 35 days out
 * (fresh, 0.3h) while a qualifying session 10 days out sat stale (120.5h) in the SAME chain/tier,
 * because (a) T2's bucket ordering was staleness-only with no proximity awareness, and (b) the
 * reserved-new lane always guaranteed the never-fetched horizon-edge date, jumping every
 * already-cached nearer date. Both fixes are opt-in via `selectDueSessions` opts so pre-existing
 * callers (and pre-existing tests) that omit `horizonEdgeDate`/`reserveNewEdgeExcludeDays` keep the
 * exact legacy behaviour.
 */

function known(
  overrides: Partial<KnownSession> & { sessionId: string; tier: KnownSession["tier"]; fetchedAt: Date },
): KnownSession {
  return {
    chain: "event",
    cinemaId: "C1",
    date: "2026-10-05",
    live: true,
    neverFetched: false,
    ...overrides,
  };
}

function selectedIds(result: ReturnType<typeof selectDueSessions>): string[] {
  return [...result.selected];
}

// nowInstant resolves to Sydney calendar date "2026-10-05" (Sydney is UTC+11 in October — AEDT —
// so 00:00Z is already into 2026-10-05 local), matching the existing select-reserve.test.ts fixtures.
const NOW = new Date("2026-10-05T00:00:00.000Z");

test("#46 proximity: within T2, a near-term date wins the budget over a far-horizon date even when the far date is staler", () => {
  const nearTerm = known({
    sessionId: "near-10d",
    tier: "T2",
    date: "2026-10-15", // 10 days out
    // Comfortably past the jittered T2 TTL (24h +/-15%) so it's unambiguously due, but still the
    // LESS stale of the two — proximity, not staleness, must be what wins it the budget.
    fetchedAt: new Date(NOW.getTime() - 30 * 60 * 60_000),
  });
  const farHorizon = known({
    sessionId: "far-35d",
    tier: "T2",
    date: "2026-11-09", // 35 days out
    fetchedAt: new Date(0), // maximally stale (epoch) — the horizon-edge discovery pattern
  });

  const result = selectDueSessions([nearTerm, farHorizon], {
    budgetPerChain: 1,
    reserveForNew: 0,
    nowInstant: NOW,
  });

  assert.deepEqual(
    selectedIds(result),
    ["near-10d"],
    "proximity (not raw staleness) decides T2 budget priority",
  );
});

test("#46 proximity: T0/T1 ordering is unaffected — stalest-bucket-first is preserved", () => {
  const olderT0 = known({
    sessionId: "t0-older",
    tier: "T0",
    date: "2026-10-06",
    fetchedAt: new Date(NOW.getTime() - 2 * 60 * 60_000),
  });
  const newerT0 = known({
    sessionId: "t0-newer",
    tier: "T0",
    date: "2026-10-05",
    fetchedAt: new Date(NOW.getTime() - 90 * 60_000),
  });

  const result = selectDueSessions([olderT0, newerT0], {
    budgetPerChain: 1,
    reserveForNew: 0,
    nowInstant: NOW,
  });

  assert.deepEqual(
    selectedIds(result),
    ["t0-older"],
    "T0 still picks the stalest bucket first, regardless of date proximity",
  );
});

test("#46 reserve lane: a never-fetched session at the horizon edge is excluded from the reserved lane and loses the budget to a nearer known date", () => {
  const horizonEdgeDate = "2026-11-09"; // today + 35
  const knownMid = known({
    sessionId: "known-mid",
    tier: "T2",
    date: "2026-10-15",
    fetchedAt: new Date(NOW.getTime() - 30 * 60 * 60_000),
  });
  const newAtEdge = known({
    sessionId: "new-edge",
    tier: "T2",
    date: horizonEdgeDate,
    fetchedAt: new Date(0),
    neverFetched: true,
  });

  const result = selectDueSessions([knownMid, newAtEdge], {
    budgetPerChain: 1,
    reserveForNew: 1,
    nowInstant: NOW,
    horizonEdgeDate,
    reserveNewEdgeExcludeDays: 2,
  });

  assert.deepEqual(
    selectedIds(result),
    ["known-mid"],
    "the horizon-edge new session is excluded from the reserved lane and loses the main-pass budget to the nearer date",
  );
  const skippedIds = result.skipped.flatMap((s) => (s.date === horizonEdgeDate ? [s.count] : []));
  assert.deepEqual(skippedIds, [1], "the excluded new-edge session is reported as budget-skipped, never silently dropped");
});

test("#46 reserve lane: without horizonEdgeDate/reserveNewEdgeExcludeDays opts, legacy behaviour is preserved (edge session still gets the guaranteed reserved lane)", () => {
  const knownMid = known({
    sessionId: "known-mid",
    tier: "T2",
    date: "2026-10-15",
    fetchedAt: new Date(NOW.getTime() - 30 * 60 * 60_000),
  });
  const newAtEdge = known({
    sessionId: "new-edge",
    tier: "T2",
    date: "2026-11-09",
    fetchedAt: new Date(0),
    neverFetched: true,
  });

  const result = selectDueSessions([knownMid, newAtEdge], {
    budgetPerChain: 1,
    reserveForNew: 1,
    nowInstant: NOW,
    // horizonEdgeDate / reserveNewEdgeExcludeDays omitted — legacy behaviour.
  });

  assert.ok(
    selectedIds(result).includes("new-edge"),
    "omitting the new opts reproduces pre-#46 behaviour: the reserved lane still guarantees the edge session",
  );
  assert.equal(result.selected.length, 2, "reserved + main-budget selections are both present");
});

test("#46 reserve lane exact boundary: distance == excludeDays is excluded; distance == excludeDays+1 is reserve-eligible again (pins the <= boundary)", () => {
  const horizonEdgeDate = "2026-11-09"; // today + 35
  const mkNew = (sessionId: string, date: string): KnownSession =>
    known({ sessionId, tier: "T2", date, fetchedAt: new Date(0), neverFetched: true });

  const atBoundary = mkNew("new-at-boundary", "2026-11-07"); // edge - 2 => distance == excludeDays
  const justInside = mkNew("new-just-inside", "2026-11-06"); // edge - 3 => distance == excludeDays+1

  // budget 0 so ONLY the reserved lane can select anything — reserve eligibility is the whole test.
  const result = selectDueSessions([atBoundary, justInside], {
    budgetPerChain: 0,
    reserveForNew: 2,
    nowInstant: NOW,
    horizonEdgeDate,
    reserveNewEdgeExcludeDays: 2,
  });

  assert.deepEqual(
    selectedIds(result),
    ["new-just-inside"],
    "distance excludeDays+1 gets the reserved lane; distance == excludeDays does not (<= boundary)",
  );
});

test("#46 reserve lane: reserveNewEdgeExcludeDays=0 explicitly disables the exclusion", () => {
  const newAtEdge = known({
    sessionId: "new-edge",
    tier: "T2",
    date: "2026-11-09",
    fetchedAt: new Date(0),
    neverFetched: true,
  });

  const result = selectDueSessions([newAtEdge], {
    budgetPerChain: 0,
    reserveForNew: 1,
    nowInstant: NOW,
    horizonEdgeDate: "2026-11-09",
    reserveNewEdgeExcludeDays: 0,
  });

  assert.deepEqual(selectedIds(result), ["new-edge"], "excludeDays=0 is a no-op — the edge session is still reserved");
});
