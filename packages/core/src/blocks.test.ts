import { test } from "node:test";
import assert from "node:assert/strict";
import { findAdjacentBlocks, type BlockSeat } from "./blocks.ts";

/** Build a single row of available seats with given (col -> score). row defaults to 0. */
function row(scores: Record<number, number>, rowIdx = 0, label = "A"): BlockSeat[] {
  return Object.entries(scores).map(([col, score]) => ({
    id: `${label}${col}`,
    rowLabel: label,
    row: rowIdx,
    col: Number(col),
    score,
  }));
}

test("finds a block of the requested size in a contiguous in-zone run", () => {
  const seats = row({ 0: 80, 1: 85, 2: 90, 3: 88, 4: 70 });
  const blocks = findAdjacentBlocks(seats, { minScore: 74, size: 3 });
  assert.equal(blocks.length, 1);
  // Best 3-window is cols 1-3 (85,90,88 avg 88), not 0-2 (avg 85).
  assert.deepEqual(blocks[0]!.seatIds, ["A1", "A2", "A3"]);
  assert.equal(blocks[0]!.avgScore, 88);
  assert.equal(blocks[0]!.minScore, 85);
  assert.equal(blocks[0]!.startCol, 1);
});

test("a column gap (sold seat / aisle) breaks adjacency", () => {
  // cols 0,1 present, col 2 absent (sold), cols 3,4 present.
  const seats = row({ 0: 90, 1: 90, 3: 90, 4: 90 });
  assert.equal(findAdjacentBlocks(seats, { minScore: 74, size: 3 }).length, 0);
  const pairs = findAdjacentBlocks(seats, { minScore: 74, size: 2 });
  assert.equal(pairs.length, 2);
  assert.deepEqual(
    pairs.map((b) => b.startCol).sort((a, b) => a - b),
    [0, 3],
  );
});

test("a below-threshold seat breaks the run and is excluded", () => {
  const seats = row({ 0: 90, 1: 90, 2: 50, 3: 90, 4: 90 });
  assert.equal(findAdjacentBlocks(seats, { minScore: 74, size: 3 }).length, 0);
  const pairs = findAdjacentBlocks(seats, { minScore: 74, size: 2 });
  assert.equal(pairs.length, 2);
  for (const b of pairs) assert.ok(!b.seatIds.includes("A2"));
});

test("minScore is tunable: raising it can dissolve a block", () => {
  const seats = row({ 0: 80, 1: 82, 2: 84 });
  assert.equal(findAdjacentBlocks(seats, { minScore: 74, size: 3 }).length, 1);
  assert.equal(findAdjacentBlocks(seats, { minScore: 85, size: 3 }).length, 0);
});

test("ranks blocks across rows best-first by average score", () => {
  const seats = [
    ...row({ 0: 95, 1: 96 }, 0, "A"), // avg 95.5 -> 96
    ...row({ 0: 78, 1: 80 }, 1, "B"), // avg 79
    ...row({ 0: 88, 1: 90 }, 2, "C"), // avg 89
  ];
  const blocks = findAdjacentBlocks(seats, { minScore: 74, size: 2 });
  assert.deepEqual(
    blocks.map((b) => b.rowLabel),
    ["A", "C", "B"],
  );
});

test("size larger than any run yields no blocks; empty input is safe", () => {
  assert.equal(findAdjacentBlocks(row({ 0: 90, 1: 90 }), { minScore: 74, size: 4 }).length, 0);
  assert.equal(findAdjacentBlocks([], { minScore: 74, size: 2 }).length, 0);
  assert.equal(findAdjacentBlocks(row({ 0: 90 }), { minScore: 74, size: 0 }).length, 0);
});

test("geometry-agnostic: index-order columns (Hoyts-style) work the same", () => {
  // Hoyts has no measured coords; cols are array indices. Adjacency by contiguous index still holds.
  const seats = row({ 10: 91, 11: 92, 12: 93 }, 4, "K");
  const blocks = findAdjacentBlocks(seats, { minScore: 74, size: 3 });
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0]!.seatIds, ["K10", "K11", "K12"]);
});
