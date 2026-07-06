// L2b — client-side filters over the normalised session cache.
//
// TZ caveat: the cache `startTime` is an approximate UTC ISO string (per
// design/seats-together-design.md the cached start_time is approximate). For v1
// we read the WALL-CLOCK fields directly off the ISO string (the HH and the
// YYYY-MM-DD), i.e. we treat the literal characters as local time and do NOT
// timezone-convert. This keeps filtering deterministic and independent of the
// runner's TZ. Revisit once #39/ingest pins a real local start time.
import type { ScreenFormat, Session } from "../types";

export type TimePreset = "any" | "evenings" | "weekends";

/**
 * #92: a selected format chip. `raw: null` matches by `kind` alone (the fixed-label kinds -
 * imax/vmax/goldclass/standard - where every session of that kind gets the same chip regardless
 * of its raw label). `raw: string` matches `kind` AND the session's trimmed raw label exactly
 * (premium/other chips, e.g. "LUX" or "Xtremescreen" - `raw: ""` is the label-less fallback
 * bucket, distinct from "match any raw").
 */
export interface FormatSelector {
  kind: ScreenFormat["kind"];
  raw: string | null;
}

/** Format multi-select. Empty selection = no filter (all pass). */
export function matchesFormat(session: Session, selected: FormatSelector[]): boolean {
  if (selected.length === 0) return true;
  return selected.some((sel) => {
    if (sel.kind !== session.format.kind) return false;
    if (sel.raw === null) return true;
    return (session.format.raw?.trim() ?? "") === sel.raw;
  });
}

/** Wall-clock hour (0-23) read straight off the ISO string, no TZ conversion. */
function wallClockHour(startTime: string): number {
  return Number(startTime.slice(11, 13));
}

/** UTC weekday (0=Sun..6=Sat) of the date part — date-only, so TZ-stable. */
function weekday(startTime: string): number {
  return new Date(`${startTime.slice(0, 10)}T00:00:00Z`).getUTCDay();
}

/** Evening = wall-clock start hour >= 17:00. */
export function isEvening(session: Session): boolean {
  return wallClockHour(session.startTime) >= 17;
}

/** Weekend = Saturday or Sunday. */
export function isWeekend(session: Session): boolean {
  const day = weekday(session.startTime);
  return day === 0 || day === 6;
}

/**
 * Time-of-day preset. Presets are modelled from the separate isEvening/isWeekend
 * predicates so callers can compose them (e.g. Evenings ∩ Weekends, L2b.3).
 */
export function matchesTime(session: Session, preset: TimePreset): boolean {
  switch (preset) {
    case "any":
      return true;
    case "evenings":
      return isEvening(session);
    case "weekends":
      return isWeekend(session);
  }
}
