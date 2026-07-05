import { test } from "node:test";
import assert from "node:assert/strict";
import type { SeatMap } from "./types.ts";

/** #52: geometryConfidence flags whether an adapter's row/col coords are chain-published
 *  ("exact") or inferred from array order ("approximate", e.g. Hoyts). */
function seatMap(geometryConfidence: SeatMap["geometryConfidence"]): SeatMap {
  return {
    chain: "event",
    sessionId: "s1",
    areas: [],
    seats: [],
    geometryConfidence,
  };
}

test("SeatMap.geometryConfidence accepts 'exact'", () => {
  assert.equal(seatMap("exact").geometryConfidence, "exact");
});

test("SeatMap.geometryConfidence accepts 'approximate'", () => {
  assert.equal(seatMap("approximate").geometryConfidence, "approximate");
});
