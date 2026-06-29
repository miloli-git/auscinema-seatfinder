/**
 * Pure rolling-horizon date math (#60). No clock, no I/O: `today` is always injected.
 * UTC-midnight calendar math mirrors `ymd` / `datesInRange` in watches.ts so there is no TZ drift.
 */

import { MAX_RANGE_DAYS } from "./watches.js";

const MS_PER_DAY = 86_400_000;

/** Format a Date (UTC fields) as "YYYY-MM-DD". */
function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add `days` to a "YYYY-MM-DD" calendar date, UTC-midnight math (no TZ drift). days may be 0 or negative. */
export function addCalendarDays(ymdDate: string, days: number): string {
  const base = Date.parse(`${ymdDate}T00:00:00Z`);
  if (Number.isNaN(base)) throw new Error(`addCalendarDays: invalid date "${ymdDate}"`);
  return ymd(new Date(base + days * MS_PER_DAY));
}

/** Default rolling horizon depth in days. Env REFRESH_HORIZON_DAYS overrides (positive int). */
export const DEFAULT_HORIZON_DAYS = 35;

/**
 * Resolve the configured horizon depth from env, falling back to DEFAULT_HORIZON_DAYS.
 * Clamped to MAX_RANGE_DAYS-1 (365): the discovery window is inclusive (today..today+H = H+1 dates),
 * so any H >= MAX_RANGE_DAYS would make datesInRange throw and crash the whole locked tick.
 */
export function resolveHorizonDays(env: Record<string, string | undefined> = process.env): number {
  const raw = env.REFRESH_HORIZON_DAYS;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_RANGE_DAYS - 1) : DEFAULT_HORIZON_DAYS;
}

/** The far edge of coverage the cache is attempting = today + horizonDays. */
export function horizonDate(today: string, horizonDays: number): string {
  return addCalendarDays(today, horizonDays);
}

/**
 * The rolling discovery/scope window for a watch, given the Sydney "today" and horizon depth.
 *   from = max(today, watch.dateFrom)   — never scan the past; honour a watch that starts later
 *   to   = today + horizonDays          — rolling far edge (the watch's static dateTo is NOT a cap)
 * Returns null when the window is empty (from > to), e.g. a watch whose dateFrom is beyond the horizon.
 */
export function effectiveWindow(
  watch: { dateFrom: string; dateTo: string },
  today: string,
  horizonDays: number,
): { from: string; to: string } | null {
  const from = watch.dateFrom > today ? watch.dateFrom : today;
  const to = horizonDate(today, horizonDays);
  if (from > to) return null;
  return { from, to };
}
