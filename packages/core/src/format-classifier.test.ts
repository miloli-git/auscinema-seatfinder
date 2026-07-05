import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFormat } from "./format-classifier.ts";

test("empty string -> standard, rank 0, not large-format", () => {
  assert.deepEqual(classifyFormat(""), { formatRank: 0, isLargeFormat: false });
});

test("'standard' (any case/whitespace) -> rank 0, not large-format", () => {
  assert.deepEqual(classifyFormat("standard"), { formatRank: 0, isLargeFormat: false });
  assert.deepEqual(classifyFormat("  Standard  "), { formatRank: 0, isLargeFormat: false });
  assert.deepEqual(classifyFormat("STANDARD"), { formatRank: 0, isLargeFormat: false });
});

test("'IMAX' (any case) -> rank 2, large-format", () => {
  assert.deepEqual(classifyFormat("IMAX"), { formatRank: 2, isLargeFormat: true });
  assert.deepEqual(classifyFormat("imax"), { formatRank: 2, isLargeFormat: true });
});

test("Vmax variants -> rank 1, large-format", () => {
  assert.deepEqual(classifyFormat("Vmax"), { formatRank: 1, isLargeFormat: true });
  assert.deepEqual(classifyFormat("V-Max"), { formatRank: 1, isLargeFormat: true });
  assert.deepEqual(classifyFormat("VMAX"), { formatRank: 1, isLargeFormat: true });
});

test("Xtreme variants -> rank 1, large-format", () => {
  assert.deepEqual(classifyFormat("Xtremescreen"), { formatRank: 1, isLargeFormat: true });
  assert.deepEqual(classifyFormat("Titan XC Xtreme"), { formatRank: 1, isLargeFormat: true });
});

test("other non-empty, non-standard labels -> rank 1, large-format (mirrors format.ts other-kind rule)", () => {
  assert.deepEqual(classifyFormat("Gold Class"), { formatRank: 1, isLargeFormat: true });
  assert.deepEqual(classifyFormat("Titan XC"), { formatRank: 1, isLargeFormat: true });
  assert.deepEqual(classifyFormat("Premium"), { formatRank: 1, isLargeFormat: true });
  assert.deepEqual(classifyFormat("unknown-other-label"), { formatRank: 1, isLargeFormat: true });
});
