import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFitTier } from "./fit-tier.ts";
import type { BlockSeat } from "./blocks.ts";

/** One row of available seats with given (col -> score). row defaults to 0. */
function row(scores: Record<number, number>, rowIdx = 0, label = "A"): BlockSeat[] {
  return Object.entries(scores).map(([col, score]) => ({
    id: `${label}${col}`,
    rowLabel: label,
    row: rowIdx,
    col: Number(col),
    score,
  }));
}

test("together: exact-size block found at party size", () => {
  const seats = row({ 0: 90, 1: 92, 2: 88 });
  const result = computeFitTier(seats, 74, 3);
  assert.equal(result.fitTier, "together");
  assert.equal(result.togetherCount, 3);
  assert.equal(result.bestBlockSize, 3);
  assert.equal(result.bestBlockScore, 90); // avg of 90,92,88 rounded
});

test("nearby: no party-size block, but a smaller run (>=2) exists", () => {
  // party=3: only a run of 2 in-zone seats exists (cols 0,1), col 2 is below threshold.
  const seats = row({ 0: 80, 1: 82, 2: 50 });
  const result = computeFitTier(seats, 74, 3);
  assert.equal(result.fitTier, "nearby");
  assert.equal(result.togetherCount, 2);
  assert.equal(result.bestBlockSize, 2);
  assert.equal(result.bestBlockScore, 81);
});

test("nearby searches decreasing sizes from party-1 down to 2, stopping at the first hit", () => {
  // party=5: no run of 5,4,3 exists; a run of 2 exists (cols 10,11).
  const seats = row({ 10: 80, 11: 80 });
  const result = computeFitTier(seats, 74, 5);
  assert.equal(result.fitTier, "nearby");
  assert.equal(result.togetherCount, 2);
});

test("split: no run of 2+ found, isolated in-zone seats counted and capped at party", () => {
  // party=3: two isolated in-zone seats (col 0 and col 5, not adjacent), one below-threshold seat.
  const seats = row({ 0: 90, 3: 40, 5: 88 });
  const result = computeFitTier(seats, 74, 3);
  assert.equal(result.fitTier, "split");
  assert.equal(result.togetherCount, 2);
  assert.equal(result.bestBlockScore, null);
  assert.equal(result.bestBlockSize, null);
});

test("split: togetherCount caps at party even with more isolated in-zone seats", () => {
  const seats = row({ 0: 90, 3: 88, 6: 85, 9: 80 }); // 4 isolated in-zone seats, party=2
  const result = computeFitTier(seats, 74, 2);
  assert.equal(result.fitTier, "split");
  assert.equal(result.togetherCount, 2);
});

test("split: zero in-zone seats -> togetherCount 0", () => {
  const seats = row({ 0: 40, 1: 30 });
  const result = computeFitTier(seats, 74, 2);
  assert.equal(result.fitTier, "split");
  assert.equal(result.togetherCount, 0);
});

test("party=1: a single in-zone seat is 'together' (findAdjacentBlocks size:1 matches trivially)", () => {
  const seats = row({ 0: 80 });
  const result = computeFitTier(seats, 74, 1);
  assert.equal(result.fitTier, "together");
  assert.equal(result.togetherCount, 1);
  assert.equal(result.bestBlockSize, 1);
});

test("party=1: no in-zone seats at all -> split with togetherCount 0 (nearby loop skipped entirely)", () => {
  const seats = row({ 0: 40 });
  const result = computeFitTier(seats, 74, 1);
  assert.equal(result.fitTier, "split");
  assert.equal(result.togetherCount, 0);
  assert.equal(result.bestBlockScore, null);
});

test("no seats at all -> split, togetherCount 0", () => {
  const result = computeFitTier([], 74, 2);
  assert.equal(result.fitTier, "split");
  assert.equal(result.togetherCount, 0);
  assert.equal(result.bestBlockScore, null);
  assert.equal(result.bestBlockSize, null);
});

// #47a contract §6 fixture cases (party=3, minScore=74) -------------------------------------------

test("contract fixture — Session A (Event): party-of-3 block exists -> together, avgScore 91", () => {
  const seats = row({ 0: 90, 1: 91, 2: 92 });
  const result = computeFitTier(seats, 74, 3);
  assert.equal(result.fitTier, "together");
  assert.equal(result.togetherCount, 3);
  assert.equal(result.bestBlockScore, 91);
  assert.equal(result.bestBlockSize, 3);
});

test("contract fixture — Session B (Hoyts): one isolated seat + one isolated seat two rows away -> split, togetherCount 2", () => {
  const seats = [...row({ 0: 90 }, 0, "A"), ...row({ 3: 85 }, 2, "C")];
  const result = computeFitTier(seats, 74, 3);
  assert.equal(result.fitTier, "split");
  assert.equal(result.togetherCount, 2);
  assert.equal(result.bestBlockScore, null);
  assert.equal(result.bestBlockSize, null);
});

test("contract fixture — Session C (Village): run of exactly 2, not 3 -> nearby, togetherCount 2", () => {
  const seats = row({ 0: 78, 1: 78 });
  const result = computeFitTier(seats, 74, 3);
  assert.equal(result.fitTier, "nearby");
  assert.equal(result.togetherCount, 2);
  assert.equal(result.bestBlockScore, 78);
  assert.equal(result.bestBlockSize, 2);
});
