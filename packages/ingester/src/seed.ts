/**
 * Seed the `watches` table from a watches.json file (C9 / P30.4). `watches.json` is the AUTHORITATIVE
 * desired enabled set: seeding reconciles the DB to it inside ONE transaction —
 *   - INSERT seeds whose natural key is absent (enabled=true),
 *   - RE-ENABLE a seed whose natural key exists but is disabled (and refresh its window/party/minScore),
 *   - DISABLE (never delete — cached sessions stay) any currently-enabled DB watch absent from the file,
 *   - leave an already-enabled present key UNCHANGED.
 * Natural key = (chain, cinemaIds-as-SORTED-set, movieId); the date window is NOT part of the key.
 * A seed with a comma-containing or empty cinemaId token rejects loudly and persists nothing.
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

/** C9 natural key: chain + cinemaIds as an order-insensitive sorted set + movieId (date window excluded). */
function naturalKey(chain: string, cinemaIds: string[], movieId: string | null | undefined): string {
  return `${chain}|${[...cinemaIds].sort().join(",")}|${movieId ?? ""}`;
}

/** C9 guard: every cinemaId must be a single non-empty token (no comma, no blank). Rejects loudly. */
function assertCinemaTokens(seeds: WatchSeed[]): void {
  for (let i = 0; i < seeds.length; i++) {
    for (const id of seeds[i]!.cinemaIds) {
      if (id.includes(",")) fail(`watches[${i}].cinemaIds token "${id}" must not contain a comma`);
      if (id.trim() === "") fail(`watches[${i}].cinemaIds token must not be empty`);
    }
  }
}

type ExistingWatch = { id: number; key: string; enabled: boolean };

/**
 * Reconcile the `watches` table to the authoritative `seeds`. Returns C9 counts. The whole
 * reconciliation runs in ONE transaction: a validation throw (or any error) rolls everything back.
 */
export async function seedWatches(
  pool: Pool,
  seeds: WatchSeed[],
): Promise<{ inserted: number; reEnabled: number; disabled: number; unchanged: number }> {
  // Validate before opening the transaction — nothing has persisted, so a throw here is all-or-nothing.
  assertCinemaTokens(seeds);

  const seedKeys = new Set(seeds.map((s) => naturalKey(s.chain, s.cinemaIds, s.movieId)));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<{
      id: number;
      chain: string;
      cinema_ids: string[];
      movie_id: string | null;
      enabled: boolean;
    }>(`SELECT id::int AS id, chain, cinema_ids, movie_id, enabled FROM watches`);

    const existing: ExistingWatch[] = rows.map((r) => ({
      id: r.id,
      key: naturalKey(r.chain, r.cinema_ids, r.movie_id),
      enabled: r.enabled,
    }));
    const existingByKey = new Map<string, ExistingWatch[]>();
    for (const w of existing) {
      const list = existingByKey.get(w.key);
      if (list) list.push(w);
      else existingByKey.set(w.key, [w]);
    }

    let inserted = 0;
    let reEnabled = 0;
    let disabled = 0;
    let unchanged = 0;

    for (const s of seeds) {
      const key = naturalKey(s.chain, s.cinemaIds, s.movieId);
      const matches = existingByKey.get(key) ?? [];
      if (matches.length === 0) {
        await client.query(
          `INSERT INTO watches (chain, cinema_ids, date_from, date_to, movie_id, party, min_score, scoring, enabled)
           VALUES ($1, $2::text[], $3, $4, $5, $6, $7, $8, true)`,
          [
            s.chain,
            s.cinemaIds,
            s.dateFrom,
            s.dateTo,
            s.movieId ?? null,
            s.party ?? 2,
            s.minScore ?? 74,
            s.scoring ? JSON.stringify(s.scoring) : null,
          ],
        );
        inserted++;
      } else if (matches.some((m) => m.enabled)) {
        // Key already present and enabled — desired state already holds.
        unchanged++;
      } else {
        // Key present but every matching row is disabled — re-enable one and refresh it to the file's values.
        await client.query(
          `UPDATE watches
              SET enabled = true, date_from = $2, date_to = $3, party = $4, min_score = $5,
                  scoring = $6
            WHERE id = $1`,
          [
            matches[0]!.id,
            s.dateFrom,
            s.dateTo,
            s.party ?? 2,
            s.minScore ?? 74,
            s.scoring ? JSON.stringify(s.scoring) : null,
          ],
        );
        reEnabled++;
      }
    }

    // Disable-orphan: any DB watch enabled at the start of this call whose key is not in the file.
    for (const w of existing) {
      if (w.enabled && !seedKeys.has(w.key)) {
        await client.query(`UPDATE watches SET enabled = false WHERE id = $1`, [w.id]);
        disabled++;
      }
    }

    await client.query("COMMIT");
    return { inserted, reEnabled, disabled, unchanged };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
