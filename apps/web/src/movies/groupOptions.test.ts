import { describe, expect, it } from "vitest";
import { groupDatesByParty, mergeGroupOptions, stablePartitionByDate } from "./groupOptions";
import type { Option, OptionsResponse } from "./types";

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

function response(options: Option[], overrides: Partial<OptionsResponse> = {}): OptionsResponse {
  return {
    movieKey: "event:555",
    movieTitle: "Dune: Part Two",
    party: 2,
    minScore: 74,
    count: options.length,
    options,
    freshness: {
      oldestFetchedAt: "2026-07-21T01:00:00.000Z",
      newestFetchedAt: "2026-07-21T01:00:00.000Z",
      lastSuccessfulIngestAt: "2026-07-21T01:00:00.000Z",
      coverage: { event: "cached" },
    },
    ...overrides,
  };
}

describe("groupDatesByParty", () => {
  it("groups dates by their distinct headcount value, sorted by party then date", () => {
    const dayCounts = new Map([
      ["2026-07-19", 2],
      ["2026-07-20", 2],
      ["2026-07-21", 6],
      ["2026-07-22", 7],
    ]);
    expect(groupDatesByParty(dayCounts)).toEqual([
      { party: 2, dates: ["2026-07-19", "2026-07-20"] },
      { party: 6, dates: ["2026-07-21"] },
      { party: 7, dates: ["2026-07-22"] },
    ]);
  });

  it("empty map -> empty groups", () => {
    expect(groupDatesByParty(new Map())).toEqual([]);
  });
});

describe("stablePartitionByDate (PR #80 review BLOCKER)", () => {
  it("makes each day one contiguous run (days ascending), preserving input order within each day", () => {
    const options = [
      option({ sessionId: "tue-hi", date: "2026-07-21", bestBlockScore: 95 }),
      option({ sessionId: "mon-hi", date: "2026-07-20", bestBlockScore: 90 }),
      option({ sessionId: "tue-lo", date: "2026-07-21", bestBlockScore: 60 }),
      option({ sessionId: "mon-lo", date: "2026-07-20", bestBlockScore: 55 }),
    ];
    const out = stablePartitionByDate(options);
    expect(out.map((o) => o.sessionId)).toEqual(["mon-hi", "mon-lo", "tue-hi", "tue-lo"]);
    expect(out).not.toBe(options); // never mutates/returns the input array
  });

  it("empty input -> empty output", () => {
    expect(stablePartitionByDate([])).toEqual([]);
  });
});

describe("mergeGroupOptions", () => {
  it("PR #80 review BLOCKER: merged output is date-partitioned, not concatenated in headcount-group order", () => {
    // The party=7 group is listed FIRST here, and its day (Wed 07-22) is LATER than the party=2
    // group's day (Mon 07-20). Raw concatenation would emit Wed before Mon.
    const merged = mergeGroupOptions([
      {
        group: { party: 7, dates: ["2026-07-22"] },
        data: response([option({ sessionId: "wed", date: "2026-07-22" })]),
      },
      {
        group: { party: 2, dates: ["2026-07-20"] },
        data: response([
          option({ sessionId: "mon-a", date: "2026-07-20", bestBlockScore: 90 }),
          option({ sessionId: "mon-b", date: "2026-07-20", bestBlockScore: 60 }),
        ]),
      },
    ]);
    expect(merged.options.map((o) => o.sessionId)).toEqual(["mon-a", "mon-b", "wed"]);
  });

  it("keeps, from each response, only options whose date belongs to that response's own group — the core honesty fix", () => {
    // Sunday (2026-07-19) was left at 2; Tue/Wed (07-21/07-22) were bumped to 7. The party=7 fetch
    // will ALSO return the Sunday session (the server has no notion of per-day party) — that must be
    // dropped in favour of the party=2 fetch's own (correct) view of that same session.
    const sundaySessionAtParty2 = option({
      sessionId: "sun", date: "2026-07-19", fitTier: "together", togetherCount: 2, bestBlockScore: 97,
    });
    const sundaySessionAtParty7 = option({
      sessionId: "sun", date: "2026-07-19", fitTier: "split", togetherCount: 2, bestBlockScore: 90,
    });
    const tuesSessionAtParty7 = option({
      sessionId: "tue", date: "2026-07-21", fitTier: "together", togetherCount: 7, bestBlockScore: 88,
    });

    const merged = mergeGroupOptions([
      { group: { party: 2, dates: ["2026-07-19"] }, data: response([sundaySessionAtParty2]) },
      { group: { party: 7, dates: ["2026-07-21", "2026-07-22"] }, data: response([sundaySessionAtParty7, tuesSessionAtParty7]) },
    ]);

    const bySession = new Map(merged.options.map((o) => [o.sessionId, o]));
    expect(merged.options).toHaveLength(2); // sundaySessionAtParty7 dropped, not double-counted
    expect(bySession.get("sun")).toMatchObject({ effectiveParty: 2, fitTier: "together", togetherCount: 2 });
    expect(bySession.get("tue")).toMatchObject({ effectiveParty: 7, fitTier: "together", togetherCount: 7 });
  });

  it("merges freshness conservatively (oldest/newest/latest-ingest across all fetched groups)", () => {
    const merged = mergeGroupOptions([
      {
        group: { party: 2, dates: ["2026-07-19"] },
        data: response([option({ sessionId: "a", date: "2026-07-19" })], {
          freshness: {
            oldestFetchedAt: "2026-07-20T00:00:00.000Z",
            newestFetchedAt: "2026-07-20T00:00:00.000Z",
            lastSuccessfulIngestAt: "2026-07-20T00:00:00.000Z",
            coverage: { event: "cached" },
          },
        }),
      },
      {
        group: { party: 7, dates: ["2026-07-21"] },
        data: response([option({ sessionId: "b", date: "2026-07-21" })], {
          freshness: {
            oldestFetchedAt: "2026-07-18T00:00:00.000Z",
            newestFetchedAt: "2026-07-22T00:00:00.000Z",
            lastSuccessfulIngestAt: "2026-07-22T00:00:00.000Z",
            coverage: { village: "cached" },
          },
        }),
      },
    ]);
    expect(merged.freshness).toEqual({
      oldestFetchedAt: "2026-07-18T00:00:00.000Z",
      newestFetchedAt: "2026-07-22T00:00:00.000Z",
      lastSuccessfulIngestAt: "2026-07-22T00:00:00.000Z",
      coverage: { event: "cached", village: "cached" },
    });
  });

  it("empty input -> empty options, empty title", () => {
    expect(mergeGroupOptions([])).toEqual({
      movieTitle: "",
      options: [],
      freshness: { oldestFetchedAt: "", newestFetchedAt: "", lastSuccessfulIngestAt: "", coverage: {} },
    });
  });
});
