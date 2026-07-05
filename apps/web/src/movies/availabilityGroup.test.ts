import { describe, expect, it, vi } from "vitest";
import {
  fetchGroupAvailability,
  groupDatesByParty,
  mergeGroupAvailability,
  type AvailabilityGroupFetchResult,
} from "./availabilityGroup";
import type { AvailabilityDate, AvailabilityResponse } from "./types";

function day(overrides: Partial<AvailabilityDate>): AvailabilityDate {
  return {
    date: "2026-07-06",
    state: "no-qualifying-block",
    leadDays: 0,
    bestBlockScore: null,
    soldHeldPct: null,
    asOf: null,
    ...overrides,
  };
}

function response(dates: AvailabilityDate[], overrides: Partial<AvailabilityResponse> = {}): AvailabilityResponse {
  return {
    movieKey: "event:555",
    cinemaId: null,
    party: 2,
    minScore: 74,
    horizonDate: "2026-08-05",
    maxCachedDate: "2026-07-20",
    earliest: dates.find((d) => d.state === "good-block") ?? null,
    earliestLeadDays: dates.find((d) => d.state === "good-block")?.leadDays ?? null,
    dates,
    ...overrides,
  };
}

describe("mergeGroupAvailability", () => {
  it("live repro: Tue=6/Wed=7, everything else at 2 — merged rows come from EACH day's own headcount, not the global max", () => {
    // Baseline (party=7, the pre-fix global-max fetch): every day looks good-block at 7, INCLUDING
    // Monday, which the user never touched — this is the false claim the fix must eliminate.
    const baseline = response([
      day({ date: "2026-07-06", state: "good-block", leadDays: 0, bestBlockScore: 91, soldHeldPct: 10, asOf: "2026-07-06T00:00:00.000Z" }), // Mon
      day({ date: "2026-07-07", state: "good-block", leadDays: 1, bestBlockScore: 88 }), // Tue
      day({ date: "2026-07-08", state: "good-block", leadDays: 2, bestBlockScore: 85 }), // Wed
    ], { party: 7 });

    // Monday's OWN headcount is 2 — at party=2, Monday is honestly no-qualifying-block (the group
    // floor doesn't clear the bar this movie needs); Tue/Wed at their own headcounts (6/7) do.
    const results: AvailabilityGroupFetchResult[] = [
      {
        group: { party: 2, dates: ["2026-07-06"] },
        data: response([day({ date: "2026-07-06", state: "no-qualifying-block", leadDays: 0 })]),
      },
      {
        group: { party: 6, dates: ["2026-07-07"] },
        data: response([day({ date: "2026-07-07", state: "good-block", leadDays: 1, bestBlockScore: 80 })]),
      },
      {
        group: { party: 7, dates: ["2026-07-08"] },
        data: response([day({ date: "2026-07-08", state: "good-block", leadDays: 2, bestBlockScore: 85 })]),
      },
    ];

    const merged = mergeGroupAvailability(baseline, results);

    const byDate = new Map(merged.dates.map((d) => [d.date, d]));
    // Monday must NOT read as good-block just because the party=7 baseline said so.
    expect(byDate.get("2026-07-06")).toMatchObject({ state: "no-qualifying-block" });
    expect(byDate.get("2026-07-07")).toMatchObject({ state: "good-block", bestBlockScore: 80 });
    expect(byDate.get("2026-07-08")).toMatchObject({ state: "good-block", bestBlockScore: 85 });

    // Earliest good-block day is Tue (07-07) once Monday's false claim is corrected — not Monday.
    expect(merged.earliest?.date).toBe("2026-07-07");
    expect(merged.earliestLeadDays).toBe(1);
    expect(merged.earliestParty).toBe(6);
  });

  it("dates with no headcount group at all (no sessions that day) fall back to the baseline row untouched", () => {
    const baseline = response([
      day({ date: "2026-07-06", state: "not-cached", leadDays: 0 }),
      day({ date: "2026-07-07", state: "good-block", leadDays: 1, bestBlockScore: 90 }),
    ], { party: 2 });
    const merged = mergeGroupAvailability(baseline, [
      { group: { party: 6, dates: ["2026-07-07"] }, data: response([day({ date: "2026-07-07", state: "good-block", leadDays: 1, bestBlockScore: 70 })]) },
    ]);
    expect(merged.dates.find((d) => d.date === "2026-07-06")).toMatchObject({ state: "not-cached" });
    expect(merged.dates.find((d) => d.date === "2026-07-07")).toMatchObject({ bestBlockScore: 70 });
  });

  it("no good-block day anywhere in the merged result -> earliest/earliestParty both null", () => {
    const baseline = response([day({ date: "2026-07-06", state: "no-qualifying-block" })], { party: 2 });
    const merged = mergeGroupAvailability(baseline, [
      { group: { party: 6, dates: ["2026-07-06"] }, data: response([day({ date: "2026-07-06", state: "no-qualifying-block" })]) },
    ]);
    expect(merged.earliest).toBeNull();
    expect(merged.earliestLeadDays).toBeNull();
    expect(merged.earliestParty).toBeNull();
  });

  it("empty results -> merged output IS the baseline, unmodified", () => {
    const baseline = response([day({ date: "2026-07-06", state: "good-block", leadDays: 0 })], { party: 3 });
    const merged = mergeGroupAvailability(baseline, []);
    expect(merged.dates).toEqual(baseline.dates);
    expect(merged.earliestParty).toBe(3);
  });
});

describe("fetchGroupAvailability", () => {
  it("uniform counts (single distinct headcount): exactly ONE call, at that headcount — matches the pre-fix single-call shape", async () => {
    const fetchAvailability = vi.fn().mockResolvedValue(response([day({ date: "2026-07-06", state: "good-block", leadDays: 0 })], { party: 6 }));
    const dayCounts = new Map([["2026-07-06", 6], ["2026-07-07", 6]]);

    const result = await fetchGroupAvailability({ movieKey: "event:555", minScore: 74 }, dayCounts, 6, fetchAvailability);

    expect(fetchAvailability).toHaveBeenCalledTimes(1);
    expect(fetchAvailability).toHaveBeenCalledWith({ movieKey: "event:555", minScore: 74, party: 6 });
    expect(result.variesByDay).toBe(false);
  });

  it("empty dayCounts (solo mode / not yet seeded): exactly ONE call at fallbackParty", async () => {
    const fetchAvailability = vi.fn().mockResolvedValue(response([]));
    const result = await fetchGroupAvailability({ movieKey: "event:555", minScore: 74 }, new Map(), 1, fetchAvailability);
    expect(fetchAvailability).toHaveBeenCalledTimes(1);
    expect(fetchAvailability).toHaveBeenCalledWith({ movieKey: "event:555", minScore: 74, party: 1 });
    expect(result.variesByDay).toBe(false);
  });

  it("varying counts (>1 distinct headcount): fans out one call per distinct headcount PLUS one baseline call at fallbackParty", async () => {
    const fetchAvailability = vi.fn().mockImplementation((q) => Promise.resolve(response([], { party: q.party })));
    const dayCounts = new Map([["2026-07-06", 2], ["2026-07-07", 6], ["2026-07-08", 7]]);

    await fetchGroupAvailability({ movieKey: "event:555", minScore: 74, cinemaId: "12" }, dayCounts, 7, fetchAvailability);

    // baseline + 3 distinct headcount groups = 4 calls total.
    expect(fetchAvailability).toHaveBeenCalledTimes(4);
    expect(fetchAvailability).toHaveBeenCalledWith({ movieKey: "event:555", minScore: 74, cinemaId: "12", party: 7 }); // baseline (fallback) + party=7 group both use 7
    expect(fetchAvailability).toHaveBeenCalledWith({ movieKey: "event:555", minScore: 74, cinemaId: "12", party: 2 });
    expect(fetchAvailability).toHaveBeenCalledWith({ movieKey: "event:555", minScore: 74, cinemaId: "12", party: 6 });
  });

  it("varying counts result carries variesByDay: true", async () => {
    const fetchAvailability = vi.fn().mockImplementation((q) => Promise.resolve(response([], { party: q.party })));
    const dayCounts = new Map([["2026-07-06", 2], ["2026-07-07", 6]]);
    const result = await fetchGroupAvailability({ movieKey: "event:555", minScore: 74 }, dayCounts, 6, fetchAvailability);
    expect(result.variesByDay).toBe(true);
  });
});

describe("groupDatesByParty (re-export sanity)", () => {
  it("still available from availabilityGroup.ts for callers that only need the grouping, not the merge", () => {
    expect(groupDatesByParty(new Map([["2026-07-06", 2]]))).toEqual([{ party: 2, dates: ["2026-07-06"] }]);
  });
});
