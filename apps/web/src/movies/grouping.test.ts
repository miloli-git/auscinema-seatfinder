import { describe, expect, it } from "vitest";
import { groupTitles, matchesSearch, normalizeTitle } from "./grouping";
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

describe("normalizeTitle", () => {
  it("trims, lowercases, and collapses internal whitespace", () => {
    expect(normalizeTitle("  Dune:  Part   Two  ")).toBe("dune: part two");
  });
});

describe("groupTitles", () => {
  it("groups trivially-equal normalised titles across chains into one row, preserving distinct movieKeys", () => {
    const titles = [
      title({ movieKey: "event:555", chain: "event", title: "Dune: Part Two" }),
      title({ movieKey: "village:555", chain: "village", title: "  dune: part two  " }),
      title({ movieKey: "hoyts:900", chain: "hoyts", title: "The Odyssey" }),
    ];
    const groups = groupTitles(titles);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.entries.map((e) => e.movieKey)).toEqual(["event:555", "village:555"]);
    expect(groups[1]?.entries.map((e) => e.movieKey)).toEqual(["hoyts:900"]);
  });

  it("does not group titles that are not trivially equal (no fuzzy matching)", () => {
    const titles = [
      title({ movieKey: "event:1", title: "Dune Part Two" }),
      title({ movieKey: "village:1", title: "Dune: Part Two" }), // punctuation differs, not stripped
    ];
    const groups = groupTitles(titles);
    expect(groups).toHaveLength(2);
  });

  it("is a display grouping only — grouped entries keep their own distinct movieKeys", () => {
    const titles = [
      title({ movieKey: "event:555", chain: "event" }),
      title({ movieKey: "village:555", chain: "village" }),
    ];
    const [group] = groupTitles(titles);
    expect(group?.entries[0]?.movieKey).not.toBe(group?.entries[1]?.movieKey);
  });
});

describe("matchesSearch", () => {
  it("matches case-insensitively as a substring", () => {
    const [group] = groupTitles([title({ title: "Dune: Part Two" })]);
    if (!group) throw new Error("expected a group");
    expect(matchesSearch(group, "dune")).toBe(true);
    expect(matchesSearch(group, "PART TWO")).toBe(true);
    expect(matchesSearch(group, "odyssey")).toBe(false);
  });

  it("treats an empty/whitespace query as matching everything", () => {
    const [group] = groupTitles([title({})]);
    if (!group) throw new Error("expected a group");
    expect(matchesSearch(group, "")).toBe(true);
    expect(matchesSearch(group, "   ")).toBe(true);
  });
});
