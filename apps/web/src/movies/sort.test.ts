import { describe, expect, it } from "vitest";
import { groupTitles } from "./grouping";
import { groupSessionCount, sortGroups } from "./sort";
import type { CatalogTitle } from "./types";

function title(overrides: Partial<CatalogTitle>): CatalogTitle {
  return {
    movieKey: "event:1",
    chain: "event",
    title: "Dune: Part Two",
    sessionCount: 1,
    posterUrl: null,
    ...overrides,
  };
}

describe("groupSessionCount", () => {
  it("sums sessionCount across a group's entries", () => {
    const [group] = groupTitles([
      title({ movieKey: "event:1", title: "Dune: Part Two", sessionCount: 12 }),
      title({ movieKey: "village:1", title: "dune: part two", sessionCount: 4 }),
    ]);
    if (!group) throw new Error("expected a group");
    expect(groupSessionCount(group)).toBe(16);
  });
});

describe("sortGroups", () => {
  const groups = groupTitles([
    title({ movieKey: "event:1", title: "The Odyssey", sessionCount: 6 }),
    title({ movieKey: "event:2", title: "Dune: Part Two", sessionCount: 12 }),
    title({ movieKey: "village:2", title: "dune: part two", sessionCount: 4 }), // groups with above
    title({ movieKey: "event:3", title: "Backrooms", sessionCount: 2 }),
  ]);

  it("'sessions' mode orders by total sessionCount descending", () => {
    const sorted = sortGroups(groups, "sessions");
    expect(sorted.map((g) => g.displayTitle)).toEqual(["Dune: Part Two", "The Odyssey", "Backrooms"]);
  });

  it("'az' mode orders by displayTitle ascending, case-insensitive", () => {
    const sorted = sortGroups(groups, "az");
    expect(sorted.map((g) => g.displayTitle)).toEqual(["Backrooms", "Dune: Part Two", "The Odyssey"]);
  });

  it("does not mutate the input array", () => {
    const before = groups.map((g) => g.displayTitle);
    sortGroups(groups, "az");
    expect(groups.map((g) => g.displayTitle)).toEqual(before);
  });

  it("'sessions' mode ties break alphabetically (stable, not insertion order)", () => {
    const tied = groupTitles([
      title({ movieKey: "event:1", title: "Zeta", sessionCount: 5 }),
      title({ movieKey: "event:2", title: "Alpha", sessionCount: 5 }),
    ]);
    const sorted = sortGroups(tied, "sessions");
    expect(sorted.map((g) => g.displayTitle)).toEqual(["Alpha", "Zeta"]);
  });
});
