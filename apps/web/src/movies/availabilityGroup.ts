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
//
// Accepted request-volume profile (PR #82 review, point 3): the header (movie-scoped) and the
// strip (cinema-scoped) each run their own fan-out — 2 surfaces × (distinct headcounts + 1
// baseline) calls per settled edit, bounded by the 350ms debounce upstream. Deduping across the
// two surfaces was considered and rejected: per-cinema availability states are server-side
// aggregates (contract §1.1's cinemaId filter), NOT client-filterable from the movie-wide
// response, so the strip's cinema-scoped calls cannot be derived from the header's.

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

/**
 * Merges one baseline /availability response (full-horizon, fallback party) with one response per
 * distinct headcount group, honestly:
 * - union of dates across ALL responses (PR #82 review, point 2: per-party cache coverage can
 *   genuinely differ, so a date present only in a group response must not be silently dropped);
 * - where a date is in a group's own day set, that group's row wins; otherwise the baseline row
 *   wins (a group response's row for a date OUTSIDE its own day set is never used — that would be
 *   the wrong-party claim this module exists to prevent);
 * - `horizonDate`/`maxCachedDate` widen to the max across all responses.
 */
export function mergeGroupAvailability(
  baseline: AvailabilityResponse,
  results: readonly AvailabilityGroupFetchResult[],
): MergedAvailability {
  const rowByDate = new Map<string, { row: AvailabilityDate; party: number }>();
  for (const row of baseline.dates) rowByDate.set(row.date, { row, party: baseline.party });

  let horizonDate = baseline.horizonDate;
  let maxCachedDate = baseline.maxCachedDate;
  for (const { group, data } of results) {
    const dateSet = new Set(group.dates);
    for (const row of data.dates) {
      if (dateSet.has(row.date)) rowByDate.set(row.date, { row, party: group.party });
    }
    if (data.horizonDate > horizonDate) horizonDate = data.horizonDate;
    if (data.maxCachedDate !== null && (maxCachedDate === null || data.maxCachedDate > maxCachedDate)) {
      maxCachedDate = data.maxCachedDate;
    }
  }

  const merged = [...rowByDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dates = merged.map(([, entry]) => entry.row);

  let earliest: AvailabilityDate | null = null;
  let earliestParty: number | null = null;
  for (const [, entry] of merged) {
    if (entry.row.state === "good-block") {
      earliest = entry.row;
      earliestParty = entry.party;
      break;
    }
  }

  return {
    ...baseline,
    horizonDate,
    maxCachedDate,
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
 *
 * Partial-failure policy (PR #82 review, point 1): the group fan-out is settled per call, so one
 * failed headcount's fetch never blanks the whole header/strip. Overrides apply only from the
 * groups that resolved; a failed group's dates keep the baseline's rows — knowingly imperfect
 * (baseline party, not that day's own headcount) but fail-open per group beats rejecting the
 * entire surface, and the baseline row is at least real, labelled data. The baseline call itself
 * still rejects the whole fetch — without it there is no honest full-horizon shape to merge into
 * (same failure semantics as the pre-fix single call).
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
  const [baseline, ...settledGroups] = await Promise.all([
    fetchAvailability({ ...query, party: fallbackParty }),
    ...groups.map((group) =>
      fetchAvailability({ ...query, party: group.party }).then(
        (data): AvailabilityGroupFetchResult | null => ({ group, data }),
        () => null, // failed group: fail open, baseline rows stand for its dates (see doc comment)
      ),
    ),
  ]);
  const results = settledGroups.filter((r): r is AvailabilityGroupFetchResult => r !== null);
  const merged = mergeGroupAvailability(baseline, results);
  return { data: merged, variesByDay: true, earliestParty: merged.earliestParty };
}
