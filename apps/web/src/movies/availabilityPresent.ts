// Presentation helpers for #47b (docs/47b-contract.md §6) — the movie header summary and the
// compact date strip. Kept separate from present.ts (47a's option-card helpers) since these consume
// AvailabilityResponse, a different response shape entirely; separable for testing the same reason
// present.ts is separate from the components.

import { formatShortDate, relativeTimeAgo } from "../format";
import type { AvailabilityDate, AvailabilityResponse } from "./types";

/**
 * 47c fix #12: client-side guard alongside the server-side clamp in packages/api/src/availability.ts
 * — a negative (or over-100) sold/held percentage reads as broken math, not an honest data state.
 * Belt-and-braces: this module must never render a raw out-of-range value even if an unclamped
 * response reaches the client (a stale deploy, a different upstream, etc).
 */
function clampPct(pct: number): number {
  return Math.max(0, Math.min(100, pct));
}

/** "1 day" / "3 days" — PR #82 review point 4: "1 days out" / "next 1 days" read as broken copy. */
function pluralDays(n: number): string {
  return n === 1 ? `${n} day` : `${n} days`;
}

/** Group-mode headcount-varies-by-day info for {@link composeHeaderSummary} — see
 *  availabilityGroup.ts's fan-out/merge. `earliestParty` is the headcount that actually produced
 *  `res.earliest` (may differ from `res.party`, the fallback/baseline party). */
export interface HeaderSummaryGroupInfo {
  variesByDay: boolean;
  earliestParty: number | null;
}

/**
 * Header summary string, exact form from the locked spec (contract §6):
 * "Earliest 2 good seats: Tue 16 Jul (14 days out) · 81% sold/held as of 2h ago"
 *
 * When `earliest.soldHeldPct` is null (pre-backfill row, contract §4.3), the sold/held clause is
 * dropped entirely — never "null% sold/held", never a fabricated 0. When `earliest` itself is null
 * (no good-block date anywhere in the cached horizon), falls back to the Slice 3 honest-state copy
 * rather than a blank header. `now` is injectable for deterministic tests.
 *
 * When `group.variesByDay` is set (group mode, differing per-day headcounts — the response is a
 * MergedAvailability from availabilityGroup.ts, not a single-party /availability response), the
 * single scalar `res.party` no longer describes every day honestly, so the copy drops the "N good
 * seats" claim in favour of naming the actual headcount that produced the earliest date:
 * "Earliest good seats for your group: Tue 8 Jul (6 people, 3 days out) · ...".
 */
export function composeHeaderSummary(
  res: AvailabilityResponse,
  now: number = Date.now(),
  group?: HeaderSummaryGroupInfo,
): string {
  const { earliest } = res;
  const variesByDay = group?.variesByDay ?? false;
  if (!earliest) {
    return variesByDay
      ? `No good seats found for your group in the next ${pluralDays(res.dates.length)}`
      : `No good ${res.party}-seat block found in the next ${pluralDays(res.dates.length)}`;
  }
  const leadDays = res.earliestLeadDays ?? earliest.leadDays;
  const summaryLead = variesByDay
    ? `Earliest good seats for your group: ${formatShortDate(earliest.date)} (${group?.earliestParty ?? res.party} people, ${pluralDays(leadDays)} out)`
    : `Earliest ${res.party} good seats: ${formatShortDate(earliest.date)} (${pluralDays(leadDays)} out)`;
  let summary = summaryLead;
  if (earliest.soldHeldPct !== null && earliest.asOf) {
    summary += ` · ${clampPct(earliest.soldHeldPct)}% sold/held as of ${relativeTimeAgo(earliest.asOf, now)}`;
  }
  return summary;
}

/** Sub-case of the `not-cached` state, computed client-side from fields already in the payload
 *  (contract §3.1) — NOT a 6th state string; the API only ever sends the 5 exhaustive states. */
export type NotCachedSubState = "beyond-horizon" | "not-yet-ingested" | "no-sessions";

export function notCachedSubState(
  d: AvailabilityDate,
  res: Pick<AvailabilityResponse, "horizonDate" | "maxCachedDate">,
): NotCachedSubState {
  if (d.date > res.horizonDate) return "beyond-horizon";
  if (res.maxCachedDate === null || d.date > res.maxCachedDate) return "not-yet-ingested";
  return "no-sessions";
}

const NOT_CACHED_COPY: Record<NotCachedSubState, string> = {
  "beyond-horizon": "beyond current cache horizon",
  "not-yet-ingested": "not yet checked",
  "no-sessions": "no sessions",
};

const STATE_COPY: Record<Exclude<AvailabilityDate["state"], "not-cached">, string> = {
  "good-block": "Good seats available",
  "no-qualifying-block": "No qualifying block",
  "sold-held-now": "Sold/held now",
  stale: "Stale data",
};

/** Short label for a cell's visible glyph (grayscale — text, not color, carries the state). */
export function cellStateLabel(
  d: AvailabilityDate,
  res: Pick<AvailabilityResponse, "horizonDate" | "maxCachedDate">,
): string {
  if (d.state === "not-cached") return NOT_CACHED_COPY[notCachedSubState(d, res)];
  return STATE_COPY[d.state];
}

/** Full accessible label for a strip cell: date, state, lead days, and (when present) the
 *  block/sold-held numbers — contract §6's "tooltip/label showing leadDays and, when present,
 *  bestBlockScore/soldHeldPct." */
export function cellAccessibleLabel(
  d: AvailabilityDate,
  res: Pick<AvailabilityResponse, "horizonDate" | "maxCachedDate">,
  now: number = Date.now(),
): string {
  const parts = [`${formatShortDate(d.date)}: ${cellStateLabel(d, res)}`, `${pluralDays(d.leadDays)} out`];
  if (d.bestBlockScore !== null) parts.push(`best block score ${d.bestBlockScore}`);
  if (d.soldHeldPct !== null && d.asOf) {
    parts.push(`${clampPct(d.soldHeldPct)}% sold/held as of ${relativeTimeAgo(d.asOf, now)}`);
  }
  return parts.join(" · ");
}
