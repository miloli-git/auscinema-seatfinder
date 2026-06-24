/**
 * Seed the `watches` table from a watches.json file. Idempotent: a watch is inserted only when no
 * existing row matches (chain, cinema_ids, date_from, date_to, movie_id), so re-seeding is a no-op.
 */
import { readFile } from "node:fs/promises";
import type { SeatPreference } from "@auscinema/core";
import type { Pool } from "./db.js";

/** Shape of a watch entry in watches.json. */
export interface WatchSeed {
  chain: string;
  cinemaIds: string[];
  dateFrom: string;
  dateTo: string;
  movieId?: string | null;
  party?: number;
  minScore?: number;
  scoring?: SeatPreference | null;
  enabled?: boolean;
}

function fail(msg: string): never {
  throw new Error(`watches seed: ${msg}`);
}

function validateSeed(raw: unknown, i: number): WatchSeed {
  if (typeof raw !== "object" || raw === null) fail(`watches[${i}] must be an object`);
  const w = raw as Record<string, unknown>;
  if (typeof w.chain !== "string" || w.chain.trim() === "") fail(`watches[${i}].chain required`);
  if (!Array.isArray(w.cinemaIds) || w.cinemaIds.length === 0) fail(`watches[${i}].cinemaIds must be non-empty`);
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof w.dateFrom !== "string" || !dateRe.test(w.dateFrom)) fail(`watches[${i}].dateFrom must be YYYY-MM-DD`);
  if (typeof w.dateTo !== "string" || !dateRe.test(w.dateTo)) fail(`watches[${i}].dateTo must be YYYY-MM-DD`);
  return {
    chain: w.chain,
    cinemaIds: w.cinemaIds.map(String),
    dateFrom: w.dateFrom,
    dateTo: w.dateTo,
    movieId: w.movieId == null ? null : String(w.movieId),
    ...(typeof w.party === "number" ? { party: w.party } : {}),
    ...(typeof w.minScore === "number" ? { minScore: w.minScore } : {}),
    ...(w.scoring && typeof w.scoring === "object" ? { scoring: w.scoring as SeatPreference } : {}),
    ...(typeof w.enabled === "boolean" ? { enabled: w.enabled } : {}),
  };
}

/** Read + parse + validate a watches.json file into seeds. */
export async function loadWatchesFile(path: string): Promise<WatchSeed[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`watches seed: cannot read ${path}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`watches seed: ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) fail("root must be an array of watches");
  return parsed.map(validateSeed);
}

/** Insert seeds that do not already exist (matched on the natural key). Idempotent. */
export async function seedWatches(
  pool: Pool,
  seeds: WatchSeed[],
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const s of seeds) {
    const existing = await pool.query<{ id: string | number }>(
      `SELECT id FROM watches
        WHERE chain = $1 AND cinema_ids = $2::text[] AND date_from = $3 AND date_to = $4
          AND movie_id IS NOT DISTINCT FROM $5
        LIMIT 1`,
      [s.chain, s.cinemaIds, s.dateFrom, s.dateTo, s.movieId ?? null],
    );
    if (existing.rows.length > 0) {
      skipped++;
      continue;
    }
    await pool.query(
      `INSERT INTO watches (chain, cinema_ids, date_from, date_to, movie_id, party, min_score, scoring, enabled)
       VALUES ($1, $2::text[], $3, $4, $5, $6, $7, $8, $9)`,
      [
        s.chain,
        s.cinemaIds,
        s.dateFrom,
        s.dateTo,
        s.movieId ?? null,
        s.party ?? 2,
        s.minScore ?? 74,
        s.scoring ? JSON.stringify(s.scoring) : null,
        s.enabled ?? true,
      ],
    );
    inserted++;
  }
  return { inserted, skipped };
}
