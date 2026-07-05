// Presentation helpers for #47b (docs/47b-contract.md §6) — the movie header summary and the
// compact date strip. Kept separate from present.ts (47a's option-card helpers) since these consume
// AvailabilityResponse, a different response shape entirely; separable for testing the same reason
// present.ts is separate from the components.

import { formatShortDate, relativeTimeAgo } from "../format";
import type { AvailabilityDate, AvailabilityResponse } from "./types";

/**
 * Header summary string, exact form from the locked spec (contract §6):
 * "Earliest 2 good seats: Tue 16 Jul (14 days out) · 81% sold/held as of 2h ago"
 *
 * When `earliest.soldHeldPct` is null (pre-backfill row, contract §4.3), the sold/held clause is
 * dropped entirely — never "null% sold/held", never a fabricated 0. When `earliest` itself is null
 * (no good-block date anywhere in the cached horizon), falls back to the Slice 3 honest-state copy
 * rather than a blank header. `now` is injectable for deterministic tests.
 */
export function composeHeaderSummary(res: AvailabilityResponse, now: number = Date.now()): string {
  const { earliest } = res;
  if (!earliest) {
    return `No good ${res.party}-seat block found in the next ${res.dates.length} days`;
  }
  const leadDays = res.earliestLeadDays ?? earliest.leadDays;
  let summary = `Earliest ${res.party} good seats: ${formatShortDate(earliest.date)} (${leadDays} days out)`;
  if (earliest.soldHeldPct !== null && earliest.asOf) {
    summary += ` · ${earliest.soldHeldPct}% sold/held as of ${relativeTimeAgo(earliest.asOf, now)}`;
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
  const parts = [`${formatShortDate(d.date)}: ${cellStateLabel(d, res)}`, `${d.leadDays} days out`];
  if (d.bestBlockScore !== null) parts.push(`best block score ${d.bestBlockScore}`);
  if (d.soldHeldPct !== null && d.asOf) {
    parts.push(`${d.soldHeldPct}% sold/held as of ${relativeTimeAgo(d.asOf, now)}`);
  }
  return parts.join(" · ");
}
