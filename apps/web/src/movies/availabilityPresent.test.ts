import { describe, expect, it } from "vitest";
import {
  cellAccessibleLabel,
  cellStateLabel,
  composeHeaderSummary,
  notCachedSubState,
} from "./availabilityPresent";
import type { AvailabilityDate, AvailabilityResponse } from "./types";

const FORBIDDEN_LANGUAGE = [
  /filling fast/i,
  /likely to sell out/i,
  /sell(s|ing)? out/i,
  /act now/i,
  /expect/i,
  /will sell/i,
  /before it sells/i,
];

function assertNoForecastLanguage(s: string): void {
  for (const re of FORBIDDEN_LANGUAGE) {
    expect(s).not.toMatch(re);
  }
}

function date(overrides: Partial<AvailabilityDate>): AvailabilityDate {
  return {
    date: "2026-07-16",
    state: "good-block",
    leadDays: 2,
    bestBlockScore: 91,
    soldHeldPct: 42,
    asOf: "2026-07-16T00:30:00.000Z",
    ...overrides,
  };
}

function response(overrides: Partial<AvailabilityResponse>): AvailabilityResponse {
  const earliest = date({});
  return {
    movieKey: "event:555",
    cinemaId: null,
    party: 2,
    minScore: 74,
    horizonDate: "2026-08-18",
    maxCachedDate: "2026-07-30",
    earliest,
    earliestLeadDays: earliest.leadDays,
    earliestStale: null,
    dates: [earliest],
    ...overrides,
  };
}

describe("composeHeaderSummary", () => {
  const now = new Date("2026-07-16T02:30:00.000Z").getTime();

  it("composes the exact contract copy form when soldHeldPct/asOf are present", () => {
    const res = response({
      party: 2,
      earliest: date({ date: "2026-07-16", leadDays: 2, soldHeldPct: 81, asOf: "2026-07-16T00:30:00.000Z" }),
      earliestLeadDays: 2,
    });
    const summary = composeHeaderSummary(res, now);
    expect(summary).toBe("Earliest 2 good seats: Thu 16 Jul (2 days out) · 81% sold/held as of 2h ago");
    assertNoForecastLanguage(summary);
  });

  it("omits the sold/held clause entirely when soldHeldPct is null (never renders 'null%' or a fabricated 0)", () => {
    const res = response({
      earliest: date({ soldHeldPct: null, asOf: null }),
    });
    const summary = composeHeaderSummary(res, now);
    expect(summary).toBe("Earliest 2 good seats: Thu 16 Jul (2 days out)");
    expect(summary).not.toContain("null%");
    expect(summary).not.toContain("0% sold/held");
    assertNoForecastLanguage(summary);
  });

  it("47c fix #12: clamps a negative soldHeldPct rather than rendering it raw (belt-and-braces to the server clamp)", () => {
    const res = response({
      earliest: date({ soldHeldPct: -3 }),
    });
    const summary = composeHeaderSummary(res, now);
    expect(summary).toContain("0% sold/held");
    expect(summary).not.toContain("-3%");
  });

  it("falls back to the honest no-good-seats copy when earliest is null but the horizon was freshly checked, never a blank header", () => {
    const res = response({
      earliest: null,
      earliestLeadDays: null,
      party: 3,
      dates: [date({ state: "no-qualifying-block" }), date({ date: "2026-07-17", state: "no-qualifying-block" })],
    });
    const summary = composeHeaderSummary(res, now);
    expect(summary).toBe("No good 3-seat block found in the next 2 days");
    assertNoForecastLanguage(summary);
  });

  describe("#86 fix: honest fallback when earliest is null and the header must not claim a false absence", () => {
    it("stale-but-qualifying fallback: surfaces earliestStale with an honest 'as of' label instead of asserting absence", () => {
      const res = response({
        earliest: null,
        earliestLeadDays: null,
        party: 2,
        dates: [date({ state: "stale", bestBlockScore: null, soldHeldPct: null })],
        earliestStale: date({ date: "2026-07-28", state: "stale", leadDays: 14, bestBlockScore: 90, soldHeldPct: 55, asOf: "2026-07-27T04:30:00.000Z" }),
      });
      const summary = composeHeaderSummary(res, now);
      expect(summary).toContain("Earliest 2 good seats");
      expect(summary).toContain("Tue 28 Jul");
      expect(summary).toContain("14 days out");
      expect(summary).toMatch(/as of/i);
      expect(summary).not.toMatch(/No good/i);
      assertNoForecastLanguage(summary);
    });

    it("genuinely no data: no fresh-checked date and no stale-but-qualifying date -> honest 'no fresh availability data' copy, not a false absence claim", () => {
      const res = response({
        earliest: null,
        earliestLeadDays: null,
        party: 2,
        dates: [date({ state: "not-cached", bestBlockScore: null, soldHeldPct: null, asOf: null })],
        earliestStale: null,
      });
      const summary = composeHeaderSummary(res, now);
      expect(summary).toBe("No fresh availability data in the next 1 day");
      expect(summary).not.toMatch(/No good \d+-seat/);
      assertNoForecastLanguage(summary);
    });

    it("group mode: stale-but-qualifying fallback names the group, genuinely-no-data fallback avoids a stale party-N claim", () => {
      const staleRes = response({
        earliest: null,
        earliestLeadDays: null,
        dates: [date({ state: "stale", bestBlockScore: null, soldHeldPct: null })],
        earliestStale: date({ date: "2026-07-28", state: "stale", leadDays: 14, bestBlockScore: 90, soldHeldPct: null, asOf: null }),
      });
      const staleSummary = composeHeaderSummary(staleRes, now, { variesByDay: true, earliestParty: 6 });
      expect(staleSummary).toContain("Earliest good seats for your group");
      expect(staleSummary).toContain("6 people");

      const noDataRes = response({
        earliest: null,
        earliestLeadDays: null,
        dates: [date({ state: "not-cached", bestBlockScore: null, soldHeldPct: null, asOf: null })],
        earliestStale: null,
      });
      const noDataSummary = composeHeaderSummary(noDataRes, now, { variesByDay: true, earliestParty: null });
      expect(noDataSummary).toBe("No fresh availability data for your group in the next 1 day");
    });
  });

  it("PR #82 review point 4: singular day copy in the non-group branches — '1 day out' / 'next 1 day', never '1 days'", () => {
    const oneOut = composeHeaderSummary(
      response({ earliest: date({ leadDays: 1, soldHeldPct: null, asOf: null }), earliestLeadDays: 1 }),
      now,
    );
    expect(oneOut).toBe("Earliest 2 good seats: Thu 16 Jul (1 day out)");

    const noneInOne = composeHeaderSummary(
      response({ earliest: null, earliestLeadDays: null, dates: [date({ state: "no-qualifying-block" })] }),
      now,
    );
    expect(noneInOne).toBe("No good 2-seat block found in the next 1 day");
  });

  it("PR #83 review copy nit: singular seat copy for party 1 — 'Earliest 1 good seat', never '1 good seats'", () => {
    const solo = composeHeaderSummary(
      response({ party: 1, earliest: date({ soldHeldPct: null, asOf: null }) }),
      now,
    );
    expect(solo).toBe("Earliest 1 good seat: Thu 16 Jul (2 days out)");
  });

  describe("group.variesByDay (47c-followup: per-day headcount honesty)", () => {
    it("names the day's OWN headcount instead of the response's single `party` scalar (which is the fallback/global-max, not this day's count)", () => {
      // `res.party` is 7 (the fallback baseline party) but the earliest good-block day was actually
      // produced by the party=6 group fetch — the copy must say 6, never the misleading 7.
      const res = response({
        party: 7,
        earliest: date({ date: "2026-07-08", leadDays: 3, soldHeldPct: null, asOf: null }),
        earliestLeadDays: 3,
      });
      const summary = composeHeaderSummary(res, now, { variesByDay: true, earliestParty: 6 });
      expect(summary).toBe("Earliest good seats for your group: Wed 8 Jul (6 people, 3 days out)");
      expect(summary).not.toContain("Earliest 7");
      assertNoForecastLanguage(summary);
    });

    it("still appends the sold/held clause when present, after the varying-count copy", () => {
      const res = response({
        earliest: date({ date: "2026-07-08", leadDays: 3, soldHeldPct: 55, asOf: "2026-07-08T00:00:00.000Z" }),
        earliestLeadDays: 3,
      });
      const summary = composeHeaderSummary(res, now, { variesByDay: true, earliestParty: 6 });
      expect(summary).toContain("(6 people, 3 days out) · 55% sold/held as of");
    });

    it("no good-block day anywhere -> honest no-seats copy without a stale party-N claim", () => {
      const res = response({ earliest: null, earliestLeadDays: null, dates: [date({ state: "no-qualifying-block" })] });
      const summary = composeHeaderSummary(res, now, { variesByDay: true, earliestParty: null });
      expect(summary).toBe("No good seats found for your group in the next 1 day");
      expect(summary).not.toMatch(/No good \d+-seat/);
    });

    it("uniform counts (variesByDay: false, or omitted) keeps the original single-party copy unchanged", () => {
      const res = response({ party: 6 });
      const withFlagFalse = composeHeaderSummary(res, now, { variesByDay: false, earliestParty: 6 });
      const withoutGroupArg = composeHeaderSummary(res, now);
      expect(withFlagFalse).toBe(withoutGroupArg);
      expect(withFlagFalse).toMatch(/^Earliest 6 good seats:/);
    });
  });
});

describe("notCachedSubState", () => {
  const ctx = { horizonDate: "2026-08-18", maxCachedDate: "2026-07-30" };

  it("beyond-horizon: date past horizonDate", () => {
    expect(notCachedSubState(date({ date: "2026-08-19", state: "not-cached" }), ctx)).toBe("beyond-horizon");
  });

  it("not-yet-ingested: within horizon but past maxCachedDate", () => {
    expect(notCachedSubState(date({ date: "2026-08-01", state: "not-cached" }), ctx)).toBe("not-yet-ingested");
  });

  it("not-yet-ingested: maxCachedDate is null", () => {
    expect(
      notCachedSubState(date({ date: "2026-07-20", state: "not-cached" }), {
        horizonDate: "2026-08-18",
        maxCachedDate: null,
      }),
    ).toBe("not-yet-ingested");
  });

  it("no-sessions: within maxCachedDate but zero sessions cached", () => {
    expect(notCachedSubState(date({ date: "2026-07-20", state: "not-cached" }), ctx)).toBe("no-sessions");
  });
});

describe("cellStateLabel / cellAccessibleLabel", () => {
  const ctx = { horizonDate: "2026-08-18", maxCachedDate: "2026-07-30" };
  const now = new Date("2026-07-18T02:00:00.000Z").getTime();

  it("labels each of the 5 exhaustive states distinctly", () => {
    expect(cellStateLabel(date({ state: "good-block" }), ctx)).toBe("Good seats available");
    expect(cellStateLabel(date({ state: "no-qualifying-block" }), ctx)).toBe("No qualifying block");
    expect(cellStateLabel(date({ state: "sold-held-now" }), ctx)).toBe("Sold/held now");
    expect(cellStateLabel(date({ state: "stale" }), ctx)).toBe("Stale data");
  });

  it("labels the 3 not-cached sub-cases with distinct copy", () => {
    expect(cellStateLabel(date({ date: "2026-08-19", state: "not-cached" }), ctx)).toBe(
      "beyond current cache horizon",
    );
    expect(cellStateLabel(date({ date: "2026-08-01", state: "not-cached" }), ctx)).toBe("not yet checked");
    expect(cellStateLabel(date({ date: "2026-07-20", state: "not-cached" }), ctx)).toBe("no sessions");
  });

  it("accessible label includes date, state, and lead days always", () => {
    const label = cellAccessibleLabel(date({ bestBlockScore: null, soldHeldPct: null, asOf: null }), ctx, now);
    expect(label).toBe("Thu 16 Jul: Good seats available · 2 days out");
  });

  it("PR #82 review point 4: singular lead day in the accessible label — '1 day out', never '1 days out'", () => {
    const label = cellAccessibleLabel(date({ leadDays: 1, bestBlockScore: null, soldHeldPct: null, asOf: null }), ctx, now);
    expect(label).toBe("Thu 16 Jul: Good seats available · 1 day out");
  });

  it("accessible label appends block score and sold/held-with-asOf when present", () => {
    // 49.5h elapsed -> 50h -> now past the 48h cutover, so relativeTimeAgo renders whole days
    // (47c fix, deferred #73 OPTIONAL: "50h ago" reads worse than "2d ago").
    const label = cellAccessibleLabel(date({}), ctx, now);
    expect(label).toBe(
      "Thu 16 Jul: Good seats available · 2 days out · best block score 91 · 42% sold/held as of 2d ago",
    );
  });

  it("47c fix #12: clamps a negative soldHeldPct in the accessible label too", () => {
    const label = cellAccessibleLabel(date({ soldHeldPct: -3 }), ctx, now);
    expect(label).toContain("0% sold/held");
    expect(label).not.toContain("-3%");
  });
});
