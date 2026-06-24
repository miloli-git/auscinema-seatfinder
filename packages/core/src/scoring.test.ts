import { test } from "node:test";
import assert from "node:assert/strict";
import type { Seat, SeatMap } from "./types.ts";
import { scoreSeat, rankSeats, bestSeatScore } from "./scoring.ts";

/**
 * Build a synthetic 5-row x 5-col auditorium (rows 0..4 front->back, cols 0..4 left->right).
 * One "premium" area plus a separate "goldclass" area in the back-right corner.
 */
function makeMap(overrides: Partial<Seat>[] = []): SeatMap {
  const seats: Seat[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      seats.push({
        id: `r${row}c${col}`,
        rowLabel: String.fromCharCode(65 + row),
        row,
        col,
        status: "available",
        areaId: "main",
      });
    }
  }
  // Apply overrides by seat id.
  for (const o of overrides) {
    const i = seats.findIndex((s) => s.id === o.id);
    if (i >= 0) seats[i] = { ...seats[i]!, ...o };
  }
  return {
    chain: "event",
    sessionId: "s1",
    areas: [
      { id: "main", name: "Main", kind: "standard" },
      { id: "gold", name: "Gold Class", kind: "goldclass" },
    ],
    seats,
  };
}

test("centre ~2/3-back seat beats a front-corner seat", () => {
  const map = makeMap();
  // targetDepth 0.65 over rows 0..4 => depth ~0.67 at row 3? row3 depth=3/4=0.75; row2=0.5.
  // Centre col is 2. Mid-back centre seat: row 3, col 2. Front corner: row 0, col 0.
  const centreBack = map.seats.find((s) => s.id === "r3c2")!;
  const frontCorner = map.seats.find((s) => s.id === "r0c0")!;
  const cb = scoreSeat(centreBack, map);
  const fc = scoreSeat(frontCorner, map);
  assert.ok(cb > fc, `expected centre-back ${cb} > front-corner ${fc}`);
});

test("sold and spacer seats score 0", () => {
  const map = makeMap([
    { id: "r2c2", status: "sold" },
    { id: "r3c1", status: "spacer" },
  ]);
  assert.equal(scoreSeat(map.seats.find((s) => s.id === "r2c2")!, map), 0);
  assert.equal(scoreSeat(map.seats.find((s) => s.id === "r3c1")!, map), 0);
});

test("allowedAreaKinds zeroes a disallowed-area seat", () => {
  const map = makeMap([{ id: "r4c4", areaId: "gold" }]);
  const goldSeat = map.seats.find((s) => s.id === "r4c4")!;
  const mainSeat = map.seats.find((s) => s.id === "r3c2")!;
  // Only goldclass allowed: the standard-area seat must zero out.
  assert.equal(scoreSeat(mainSeat, map, { allowedAreaKinds: ["goldclass"] }), 0);
  assert.ok(scoreSeat(goldSeat, map, { allowedAreaKinds: ["goldclass"] }) > 0);
});

test("bestSeatScore is 0 when no seats available", () => {
  const map = makeMap();
  for (const s of map.seats) s.status = "sold";
  assert.equal(bestSeatScore(map), 0);
  assert.equal(rankSeats(map).length, 0);
});

test("rankSeats returns available seats best-first", () => {
  const map = makeMap();
  const ranked = rankSeats(map);
  assert.equal(ranked.length, 25);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1]!.score >= ranked[i]!.score);
  }
});
