// 47c fix #3 — group-mode per-day honesty. Previously every card in group mode carried
// `effectiveParty = Math.max(...dayCounts.values())` regardless of its OWN day, so setting Tue=6,
// Wed=7 made every card (including Sunday sessions left at 2) render "All 7 together" — a false
// claim about days the user never touched. Fix: fan out one /options call per DISTINCT headcount
// value actually present in dayCounts (few distinct values in practice — a handful of days rarely
// have more than 2-3 different headcounts), then keep — from EACH response — only the options whose
// OWN `date` belongs to that headcount's day set. Every kept option is stamped with the headcount
// that produced it (`effectiveParty`), so a card's together-claim is true for its own date.

import type { Option, OptionsResponse } from "./types";

export interface PartyDateGroup {
  party: number;
  dates: string[];
}

/** Groups the cached per-day headcounts into one fetch group per distinct count value. */
export function groupDatesByParty(dayCounts: ReadonlyMap<string, number>): PartyDateGroup[] {
  const byParty = new Map<number, string[]>();
  for (const [date, count] of dayCounts) {
    const existing = byParty.get(count);
    if (existing) existing.push(date);
    else byParty.set(count, [date]);
  }
  return [...byParty.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([party, dates]) => ({ party, dates: [...dates].sort() }));
}

export interface GroupFetchResult {
  group: PartyDateGroup;
  data: OptionsResponse;
}

export interface MergedGroupOptions {
  movieTitle: string;
  options: Option[];
  freshness: OptionsResponse["freshness"];
}

/**
 * Merges one /options response per distinct headcount into a single, honest option list. From each
 * response, keeps only the options whose own `date` is in that response's headcount group — an
 * option that came back from the party=7 fetch but falls on a day the user left at 2 is dropped
 * (that day's own party=2 fetch supplies the honest version of that same session instead).
 */
export function mergeGroupOptions(results: readonly GroupFetchResult[]): MergedGroupOptions {
  const options: Option[] = [];
  let movieTitle = "";
  let oldestFetchedAt: string | null = null;
  let newestFetchedAt: string | null = null;
  let lastSuccessfulIngestAt: string | null = null;
  const coverage: Record<string, string> = {};

  for (const { group, data } of results) {
    if (!movieTitle && data.movieTitle) movieTitle = data.movieTitle;
    const dateSet = new Set(group.dates);
    for (const o of data.options) {
      if (dateSet.has(o.date)) options.push({ ...o, effectiveParty: group.party });
    }
    const f = data.freshness;
    if (oldestFetchedAt === null || f.oldestFetchedAt < oldestFetchedAt) oldestFetchedAt = f.oldestFetchedAt;
    if (newestFetchedAt === null || f.newestFetchedAt > newestFetchedAt) newestFetchedAt = f.newestFetchedAt;
    if (lastSuccessfulIngestAt === null || f.lastSuccessfulIngestAt > lastSuccessfulIngestAt) {
      lastSuccessfulIngestAt = f.lastSuccessfulIngestAt;
    }
    Object.assign(coverage, f.coverage);
  }

  return {
    movieTitle,
    options,
    freshness: {
      oldestFetchedAt: oldestFetchedAt ?? "",
      newestFetchedAt: newestFetchedAt ?? "",
      lastSuccessfulIngestAt: lastSuccessfulIngestAt ?? "",
      coverage,
    },
  };
}
