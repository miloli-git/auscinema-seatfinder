import { describe, expect, it } from "vitest";
import { applyLens } from "./lenses";
import type { Option } from "./types";

function option(overrides: Partial<Option>): Option {
  return {
    chain: "event",
    cinemaId: "1",
    cinemaName: "Test Cinema",
    sessionId: overrides.sessionId ?? "s1",
    startsAt: "2026-07-21T19:00:00.000Z",
    date: "2026-07-21",
    format: "",
    isLargeFormat: false,
    formatRank: 0,
    bestBlockScore: null,
    bestBlockSize: null,
    fitTier: "split",
    togetherCount: 1,
    geometryConfidence: "exact",
    freshness: { asOf: "2026-07-21T01:00:00.000Z", state: "fresh" },
    bookingUrl: "https://example.test/book",
    ...overrides,
  };
}

describe("applyLens: together", () => {
  it("preserves server order exactly, untouched — not even a shallow re-sort", () => {
    const options = [
      option({ sessionId: "c", bestBlockScore: 50 }),
      option({ sessionId: "a", bestBlockScore: 90 }),
      option({ sessionId: "b", bestBlockScore: null }),
    ];
    const result = applyLens(options, "together");
    expect(result.options).toBe(options); // same reference — no copy
    expect(result.options.map((o) => o.sessionId)).toEqual(["c", "a", "b"]);
    expect(result.noQualifying).toBe(false);
  });
});

describe("applyLens: seats", () => {
  it("sorts by bestBlockScore desc, nulls (split rows) last", () => {
    const options = [
      option({ sessionId: "low", bestBlockScore: 60 }),
      option({ sessionId: "null", bestBlockScore: null }),
      option({ sessionId: "high", bestBlockScore: 95 }),
      option({ sessionId: "mid", bestBlockScore: 78 }),
    ];
    const result = applyLens(options, "seats");
    expect(result.options.map((o) => o.sessionId)).toEqual(["high", "mid", "low", "null"]);
  });
});

describe("applyLens: screen", () => {
  it("sorts by formatRank desc, then bestBlockScore desc", () => {
    const options = [
      option({ sessionId: "standard-good", formatRank: 0, bestBlockScore: 99 }),
      option({ sessionId: "imax-low", formatRank: 2, bestBlockScore: 40 }),
      option({ sessionId: "imax-high", formatRank: 2, bestBlockScore: 90 }),
      option({ sessionId: "vmax", formatRank: 1, bestBlockScore: 70 }),
    ];
    const result = applyLens(options, "screen");
    expect(result.options.map((o) => o.sessionId)).toEqual([
      "imax-high",
      "imax-low",
      "vmax",
      "standard-good",
    ]);
  });
});

describe("applyLens: soonest", () => {
  it("47c fix #9: is a PURE re-rank, never a filter — qualifying rows sort first (soonest), non-qualifying rows follow (also soonest), all present", () => {
    const options = [
      option({ sessionId: "late-q", bestBlockScore: 80, startsAt: "2026-07-22T20:00:00.000Z" }),
      option({ sessionId: "early-noq", bestBlockScore: null, startsAt: "2026-07-21T10:00:00.000Z" }),
      option({ sessionId: "early-q", bestBlockScore: 75, startsAt: "2026-07-21T19:00:00.000Z" }),
      option({ sessionId: "late-noq", bestBlockScore: null, startsAt: "2026-07-23T10:00:00.000Z" }),
    ];
    const result = applyLens(options, "soonest");
    // qualifying (soonest first), then non-qualifying (soonest first) — nothing dropped.
    expect(result.options.map((o) => o.sessionId)).toEqual(["early-q", "late-q", "early-noq", "late-noq"]);
    expect(result.noQualifying).toBe(false);
  });

  it("falls back to the full list sorted by startsAt asc, flagging noQualifying, when zero rows qualify", () => {
    const options = [
      option({ sessionId: "b", bestBlockScore: null, startsAt: "2026-07-22T10:00:00.000Z" }),
      option({ sessionId: "a", bestBlockScore: null, startsAt: "2026-07-21T10:00:00.000Z" }),
    ];
    const result = applyLens(options, "soonest");
    expect(result.options.map((o) => o.sessionId)).toEqual(["a", "b"]);
    expect(result.noQualifying).toBe(true);
  });
});
