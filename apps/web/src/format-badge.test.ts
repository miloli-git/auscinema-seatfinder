import { describe, expect, it } from "vitest";
import { formatBadge, isLargeFormat, largeFormatOnly } from "./format";
import type { RankedSession, ScreenFormat } from "./types";

function format(kind: ScreenFormat["kind"], raw: string): ScreenFormat {
  return { kind, raw };
}

function ranked(id: string, screenFormat: ScreenFormat): RankedSession {
  return {
    session: {
      chain: "event",
      id,
      movieId: "movie-1",
      movieName: "Example Movie",
      cinemaId: "cinema-1",
      cinemaName: "Example Cinema",
      startTime: "2026-07-21T19:00",
      format: screenFormat,
      seatAllocation: true,
      bookingUrl: `https://example.test/book/${id}`,
    },
    bestScore: 88,
    bookingUrl: `https://example.test/book/${id}`,
    topSeats: [],
  };
}

describe("isLargeFormat", () => {
  it.each([
    ["imax", "IMAX"],
    ["vmax", "V-Max"],
    ["goldclass", "Gold Class"],
    ["premium", "Premium"],
  ] satisfies Array<[ScreenFormat["kind"], string]>)(
    "returns true for %s",
    (kind, raw) => {
      expect(isLargeFormat(format(kind, raw))).toBe(true);
    },
  );

  it("returns true for labelled other formats", () => {
    expect(isLargeFormat(format("other", "Xtremescreen"))).toBe(true);
    expect(isLargeFormat(format("other", "Titan XC"))).toBe(true);
  });

  it("returns false for standard formats regardless of raw label", () => {
    expect(isLargeFormat(format("standard", "Standard"))).toBe(false);
    expect(isLargeFormat(format("standard", ""))).toBe(false);
  });

  it("returns false for unknown other formats with empty or whitespace raw", () => {
    expect(isLargeFormat(format("other", ""))).toBe(false);
    expect(isLargeFormat(format("other", "   "))).toBe(false);
  });
});

describe("formatBadge", () => {
  it("returns null for standard and empty unknown other formats", () => {
    expect(formatBadge(format("standard", "Standard"))).toBeNull();
    expect(formatBadge(format("other", ""))).toBeNull();
    expect(formatBadge(format("other", "   "))).toBeNull();
  });

  it("returns an IMAX premium badge", () => {
    expect(formatBadge(format("imax", "IMAX"))).toEqual({
      label: "IMAX",
      premium: true,
    });
  });

  it("surfaces raw labels verbatim for labelled formats", () => {
    expect(formatBadge(format("other", "Xtremescreen"))).toEqual({
      label: "Xtremescreen",
      premium: true,
    });
    expect(formatBadge(format("vmax", "V-Max"))).toEqual({
      label: "V-Max",
      premium: true,
    });
  });

  it("preserves adapter raw labels through the badge layer", () => {
    expect(formatBadge(format("other", "XTREME"))).toEqual({
      label: "XTREME",
      premium: true,
    });
    expect(formatBadge(format("other", "Titan XC"))).toEqual({
      label: "Titan XC",
      premium: true,
    });
    expect(formatBadge(format("imax", "IMAX"))).toEqual({
      label: "IMAX",
      premium: true,
    });
  });
});

describe("largeFormatOnly", () => {
  it("keeps only large-format ranked sessions when enabled and preserves all sessions when disabled", () => {
    const sessions = [
      ranked("standard", format("standard", "Standard")),
      ranked("imax", format("imax", "IMAX")),
      ranked("other-raw", format("other", "Xtremescreen")),
      ranked("other-empty", format("other", "")),
    ];

    expect(largeFormatOnly(sessions, true).map((r: RankedSession) => r.session.id)).toEqual([
      "imax",
      "other-raw",
    ]);

    const disabled = largeFormatOnly(sessions, false);
    expect(disabled).toHaveLength(4);
    expect(disabled.map((r: RankedSession) => r.session.id)).toEqual([
      "standard",
      "imax",
      "other-raw",
      "other-empty",
    ]);
  });
});
