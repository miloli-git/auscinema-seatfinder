/**
 * Loading + shaping the swept watchlist from the `watches` table, plus date-range expansion
 * and the per-date adapter query mapping.
 */
import type { SessionQuery, SeatPreference } from "@auscinema/core";
import type { Pool } from "./db.js";
import type { WatchRow } from "./types.js";

const MS_PER_DAY = 86_400_000;
const MAX_RANGE_DAYS = 366;

/** Format a Date (UTC fields) as "YYYY-MM-DD". */
function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Inclusive list of "YYYY-MM-DD" dates from `from` to `to`. Computed in UTC so there is no
 * timezone off-by-one across month/year boundaries. Returns [] when from > to.
 */
export function datesInRange(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error(`datesInRange: invalid date(s) "${from}".."${to}"`);
  }
  if (end < start) return [];
  const days = Math.round((end - start) / MS_PER_DAY) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new Error(`datesInRange: range ${from}..${to} spans ${days} days (> ${MAX_RANGE_DAYS})`);
  }
  const out: string[] = [];
  for (let i = 0; i < days; i++) out.push(ymd(new Date(start + i * MS_PER_DAY)));
  return out;
}

/** Map a watch + a single date to an adapter SessionQuery. movieId null => "" => all movies. */
export function watchToQuery(watch: WatchRow, date: string): SessionQuery {
  return { movieId: watch.movieId ?? "", cinemaIds: watch.cinemaIds, date };
}

interface RawWatchRow {
  id: string | number;
  chain: string;
  cinema_ids: string[];
  date_from: string | Date;
  date_to: string | Date;
  movie_id: string | null;
  party: number;
  min_score: number;
  scoring: SeatPreference | null;
  enabled: boolean;
}

/** Normalise a DATE column (pg may hand back a Date or a string) to "YYYY-MM-DD". */
function asYmd(v: string | Date): string {
  if (v instanceof Date) return ymd(new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())));
  return String(v).slice(0, 10);
}

function mapRow(r: RawWatchRow): WatchRow {
  return {
    id: Number(r.id),
    chain: r.chain as WatchRow["chain"],
    cinemaIds: Array.isArray(r.cinema_ids) ? r.cinema_ids.map(String) : [],
    dateFrom: asYmd(r.date_from),
    dateTo: asYmd(r.date_to),
    movieId: r.movie_id ?? null,
    party: Number(r.party),
    minScore: Number(r.min_score),
    scoring: r.scoring ?? null,
    enabled: Boolean(r.enabled),
  };
}

/** Load every enabled watch, oldest first. */
export async function loadEnabledWatches(pool: Pool): Promise<WatchRow[]> {
  const { rows } = await pool.query<RawWatchRow>(
    `SELECT id, chain, cinema_ids, date_from, date_to, movie_id, party, min_score, scoring, enabled
       FROM watches
      WHERE enabled = TRUE
      ORDER BY id`,
  );
  return rows.map(mapRow);
}
