/**
 * DB writes. Every value is parameterised ($1...) — no string-interpolated values, no injection.
 * The per-session upsert is a single transaction (upsert session + delete its seats + insert the
 * fresh available set) so re-runs are idempotent and a partial failure rolls back only that session.
 */
import type { Pool } from "./db.js";
import type { IngestCounts, SeatUpsert, SessionUpsert } from "./types.js";

/**
 * Upsert one session and replace its session_seats in a single transaction.
 *
 * - sessions: INSERT ... ON CONFLICT (id) DO UPDATE — refreshes fetched_at + last_seen.
 * - session_seats: DELETE the session's rows then INSERT the fresh AVAILABLE set (delete+insert,
 *   not append) so re-running yields identical counts. An empty seat set leaves zero rows.
 *
 * On any error the transaction is rolled back (only this session's writes are reverted) and the
 * error is rethrown for the caller's per-session isolation to record. The client is always released.
 */
export async function upsertSessionWithSeats(
  pool: Pool,
  session: SessionUpsert,
  seats: SeatUpsert[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO sessions
         (id, watch_id, chain, movie_id, movie_name, cinema_id, cinema_name, date,
          start_time, format, screen, seats_available, booking_url, seat_allocation,
          fetched_at, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now(), now())
       ON CONFLICT (id) DO UPDATE SET
          watch_id        = EXCLUDED.watch_id,
          chain           = EXCLUDED.chain,
          movie_id        = EXCLUDED.movie_id,
          movie_name      = EXCLUDED.movie_name,
          cinema_id       = EXCLUDED.cinema_id,
          cinema_name     = EXCLUDED.cinema_name,
          date            = EXCLUDED.date,
          start_time      = EXCLUDED.start_time,
          format          = EXCLUDED.format,
          screen          = EXCLUDED.screen,
          seats_available = EXCLUDED.seats_available,
          booking_url     = EXCLUDED.booking_url,
          seat_allocation = EXCLUDED.seat_allocation,
          fetched_at      = now(),
          last_seen       = now()`,
      [
        session.id,
        session.watchId,
        session.chain,
        session.movieId,
        session.movieName ?? null,
        session.cinemaId,
        session.cinemaName ?? null,
        session.date,
        session.startTime ?? null,
        session.format ?? null,
        session.screen ?? null,
        session.seatsAvailable ?? null,
        session.bookingUrl ?? null,
        session.seatAllocation ?? null,
      ],
    );

    await client.query(`DELETE FROM session_seats WHERE session_id = $1`, [session.id]);

    if (seats.length > 0) {
      // Build a parameterised multi-row VALUES list: 7 columns per seat.
      const cols = 7;
      const params: unknown[] = [];
      const tuples: string[] = [];
      for (let i = 0; i < seats.length; i++) {
        const s = seats[i]!;
        const base = i * cols;
        tuples.push(
          `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`,
        );
        params.push(
          session.id,
          s.seatId,
          s.rowLabel ?? null,
          s.row,
          s.col,
          s.areaKind ?? null,
          s.score,
        );
      }
      await client.query(
        `INSERT INTO session_seats (session_id, seat_id, row_label, row, col, area_kind, score)
         VALUES ${tuples.join(",")}`,
        params,
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure; surface the original error
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Open an ingest_runs row, returning its id. */
export async function startIngestRun(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ id: string | number }>(
    `INSERT INTO ingest_runs (started_at) VALUES (now()) RETURNING id`,
  );
  return Number(rows[0]!.id);
}

/** Close the ingest_runs row with the final counts. */
export async function finishIngestRun(pool: Pool, id: number, counts: IngestCounts): Promise<void> {
  await pool.query(
    `UPDATE ingest_runs
        SET finished_at = now(),
            watches = $2,
            sessions_upserted = $3,
            seatmaps_fetched = $4,
            errors = $5
      WHERE id = $1`,
    [id, counts.watches, counts.sessionsUpserted, counts.seatmapsFetched, counts.errors],
  );
}
