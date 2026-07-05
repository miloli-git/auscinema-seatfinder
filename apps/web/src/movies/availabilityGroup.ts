// Group-mode per-day honesty for /availability — mirrors groupOptions.ts's fix #3 pattern for the
// header summary (AvailabilitySummary) and the date strip's own /availability fetch
// (OptionSeatMapPanel). Both previously queried /availability with a single `party` = the global
// max of the per-day headcounts (debouncedEffectiveParty), so a day left at the group floor (e.g.
// Mon=2 while Tue=6/Wed=7) inherited the max party's good-block verdict for the WHOLE response —
// "Earliest 7 good seats: Mon 6 Jul" when Monday was never bumped past 2.
//
// Fix: fan out one /availability call per DISTINCT headcount present in dayCounts (via
// groupDatesByParty, already used by groupOptions.ts's /options fan-out), plus one baseline call at
// the fallback (max) party to cover the full response shape (horizonDate/maxCachedDate and any date
// in the horizon that has zero sessions at all — party can't change a no-sessions verdict, so the
// baseline's row for those dates is already honest). For each date that IS in a headcount group,
// the group's own row overrides the baseline's row. `earliest`/`earliestLeadDays` are recomputed
// from the merged, still-ascending `dates` array, and `earliestParty` records which headcount
// produced that row (for copy that names the day's actual party size, not the global max).
//
// When counts are uniform (or solo mode / no day counts seeded yet), `groupDatesByParty` returns at
// most one group — the existing single-call path is preserved exactly (same call shape the tests
// already assert on).

import type { AvailabilityQuery } from "./api";
import { groupDatesByParty, type PartyDateGroup } from "./groupOptions";
import type { AvailabilityDate, AvailabilityResponse } from "./types";

export { groupDatesByParty };

export interface AvailabilityGroupFetchResult {
  group: PartyDateGroup;
  data: AvailabilityResponse;
}

export interface MergedAvailability extends AvailabilityResponse {
  /** Headcount that produced `earliest`/`earliestLeadDays` (null when there's no earliest date). */
  earliestParty: number | null;
}

/** Merges one baseline /availability response (full-horizon, fallback party) with one response per
 *  distinct headcount group, honestly: each group's own dates override the baseline's rows for
 *  those dates; everything else keeps the baseline's row. */
export function mergeGroupAvailability(
  baseline: AvailabilityResponse,
  results: readonly AvailabilityGroupFetchResult[],
): MergedAvailability {
  const overrideByDate = new Map<string, { row: AvailabilityDate; party: number }>();
  for (const { group, data } of results) {
    const dateSet = new Set(group.dates);
    for (const row of data.dates) {
      if (dateSet.has(row.date)) overrideByDate.set(row.date, { row, party: group.party });
    }
  }

  const dates = baseline.dates.map((row) => overrideByDate.get(row.date)?.row ?? row);

  let earliest: AvailabilityDate | null = null;
  let earliestParty: number | null = null;
  for (const row of dates) {
    if (row.state === "good-block") {
      earliest = row;
      earliestParty = overrideByDate.get(row.date)?.party ?? baseline.party;
      break;
    }
  }

  return {
    ...baseline,
    dates,
    earliest,
    earliestLeadDays: earliest?.leadDays ?? null,
    earliestParty,
  };
}

export interface AvailabilityFanOutQuery {
  movieKey: string;
  minScore: number;
  cinemaId?: string;
}

export interface GroupAvailabilityResult {
  data: AvailabilityResponse;
  /** True only when the fan-out actually ran more than one headcount group — callers use this to
   *  choose between the honest per-day copy and the existing single-party copy. */
  variesByDay: boolean;
  earliestParty: number | null;
}

/**
 * Fetches /availability honestly for the current group-mode day counts (or a single call for solo
 * mode / uniform counts — `dayCounts` empty means "not in group mode, or no per-day counts to fan
 * out over yet", matching the existing behaviour exactly in that case).
 */
export async function fetchGroupAvailability(
  query: AvailabilityFanOutQuery,
  dayCounts: ReadonlyMap<string, number>,
  fallbackParty: number,
  fetchAvailability: (q: AvailabilityQuery) => Promise<AvailabilityResponse>,
): Promise<GroupAvailabilityResult> {
  const groups = groupDatesByParty(dayCounts);
  if (groups.length <= 1) {
    const party = groups[0]?.party ?? fallbackParty;
    const data = await fetchAvailability({ ...query, party });
    return { data, variesByDay: false, earliestParty: data.earliest ? party : null };
  }
  const baseline = await fetchAvailability({ ...query, party: fallbackParty });
  const results = await Promise.all(
    groups.map(async (group) => ({ group, data: await fetchAvailability({ ...query, party: group.party }) })),
  );
  const merged = mergeGroupAvailability(baseline, results);
  return { data: merged, variesByDay: true, earliestParty: merged.earliestParty };
}
