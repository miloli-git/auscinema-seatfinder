import { describe, expect, it } from "vitest";
import { displayCinemaName, fitTierLabel, freshnessLabel, optionFormatBadge } from "./present";
import type { Option } from "./types";

function option(overrides: Partial<Option>): Option {
  return {
    chain: "event",
    cinemaId: "1",
    cinemaName: "Test Cinema",
    sessionId: "s1",
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

describe("optionFormatBadge", () => {
  it("returns null for standard/unlabelled screens", () => {
    expect(optionFormatBadge(option({ isLargeFormat: false, format: "" }))).toBeNull();
  });

  it("surfaces the raw label verbatim for large-format screens", () => {
    expect(optionFormatBadge(option({ isLargeFormat: true, format: "IMAX", formatRank: 2 }))).toEqual({
      label: "IMAX",
      premium: true,
    });
    expect(optionFormatBadge(option({ isLargeFormat: true, format: "Vmax", formatRank: 1 }))).toEqual({
      label: "Vmax",
      premium: true,
    });
  });
});

describe("fitTierLabel", () => {
  it("renders each tier's honest label (47c fixes #10/#11: seat-specific, never attendance-shaped)", () => {
    expect(fitTierLabel(option({ fitTier: "together", togetherCount: 3 }), 3)).toBe("All 3 together");
    expect(fitTierLabel(option({ fitTier: "nearby", togetherCount: 2 }), 3)).toBe(
      "2 together, not all 3",
    );
    expect(fitTierLabel(option({ fitTier: "split", togetherCount: 2 }), 3)).toBe(
      "2 of 3 seats (not adjacent)",
    );
  });

  it("47c fix #3: o.effectiveParty (the headcount that actually produced this card's fitTier) wins over the list-level party fallback", () => {
    expect(
      fitTierLabel(option({ fitTier: "nearby", togetherCount: 2, effectiveParty: 2 }), 7),
    ).toBe("2 together, not all 2");
    expect(
      fitTierLabel(option({ fitTier: "split", togetherCount: 2, effectiveParty: 2 }), 7),
    ).toBe("2 of 2 seats (not adjacent)");
  });

  it("PR #80 review: pins the `effectiveParty ?? party` precedence exactly — the per-day group honesty hangs on this fallback ordering", () => {
    // 1. effectiveParty ABSENT (solo mode / raw API option) -> the list-level party is used.
    expect(
      fitTierLabel(option({ fitTier: "split", togetherCount: 3, effectiveParty: undefined }), 7),
    ).toBe("3 of 7 seats (not adjacent)");
    // 2. effectiveParty PRESENT -> it wins, even when it disagrees with the list-level party in
    //    BOTH directions (smaller and larger). A refactor flipping the precedence to
    //    `party ?? effectiveParty` (or dropping the field) would reintroduce the false
    //    together-claim on days the user never touched — these assertions make that a test failure.
    expect(
      fitTierLabel(option({ fitTier: "nearby", togetherCount: 2, effectiveParty: 3 }), 7),
    ).toBe("2 together, not all 3");
    expect(
      fitTierLabel(option({ fitTier: "nearby", togetherCount: 2, effectiveParty: 7 }), 3),
    ).toBe("2 together, not all 7");
  });
});

describe("displayCinemaName", () => {
  it("passes through a populated cinemaName", () => {
    expect(displayCinemaName(option({ cinemaName: "Event George St" }))).toBe("Event George St");
  });

  it("falls back to the chain label when cinemaName arrives blank (pre-#67-fix transition window)", () => {
    expect(displayCinemaName(option({ chain: "hoyts", cinemaName: "" }))).toBe("Hoyts");
    expect(displayCinemaName(option({ chain: "reading", cinemaName: "   " }))).toBe("Reading");
  });
});

describe("freshnessLabel", () => {
  const now = new Date("2026-07-21T04:00:00.000Z").getTime();

  it("differentiates fresh from stale honestly, at the same elapsed time", () => {
    const fresh = freshnessLabel({ asOf: "2026-07-21T02:00:00.000Z", state: "fresh" }, now);
    const stale = freshnessLabel({ asOf: "2026-07-21T02:00:00.000Z", state: "stale" }, now);
    expect(fresh).toBe("As of 2h ago");
    expect(stale).toBe("Stale · as of 2h ago");
    expect(fresh).not.toBe(stale);
  });

  it("reads 'moments ago' for sub-hour freshness rather than '0h ago'", () => {
    expect(freshnessLabel({ asOf: "2026-07-21T03:50:00.000Z", state: "fresh" }, now)).toBe(
      "As of moments ago",
    );
  });
});
