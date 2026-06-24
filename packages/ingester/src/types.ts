/**
 * Ingester domain types. The DB row shapes and the sweep result/counters.
 * Snake_case DB columns are normalised to camelCase here; chains/preferences come from core.
 */
import type { Chain, SeatPreference } from "@auscinema/core";

/** One enabled watch loaded from the `watches` table. */
export interface WatchRow {
  id: number;
  chain: Chain;
  cinemaIds: string[];
  /** Inclusive sweep range, "YYYY-MM-DD". */
  dateFrom: string;
  dateTo: string;
  /** null = all movies for the chain/cinemas. */
  movieId: string | null;
  party: number;
  minScore: number;
  /** SeatPreference passed to the scorer; null = scorer defaults. */
  scoring: SeatPreference | null;
  enabled: boolean;
}

/** A `sessions` row to upsert (chain-provided id is the PK). */
export interface SessionUpsert {
  id: string;
  watchId: number;
  chain: Chain;
  movieId: string;
  movieName?: string;
  cinemaId: string;
  cinemaName?: string;
  /** "YYYY-MM-DD". */
  date: string;
  /** ISO-local start time as the chain provides it. */
  startTime?: string;
  format?: string;
  screen?: string;
  seatsAvailable?: number;
  bookingUrl?: string;
  seatAllocation?: boolean;
}

/** A `session_seats` row to upsert — AVAILABLE + scored seats only. */
export interface SeatUpsert {
  seatId: string;
  rowLabel?: string;
  row: number;
  col: number;
  areaKind?: string;
  score: number;
}

/** A recorded error; a watch-level error has no sessionId. */
export interface SweepError {
  watchId: number;
  sessionId?: string;
  error: string;
}

/** Counts persisted to an `ingest_runs` row at finish. */
export interface IngestCounts {
  watches: number;
  sessionsUpserted: number;
  seatmapsFetched: number;
  errors: number;
}

/** The outcome of one sweep. */
export interface SweepResult {
  runId: number;
  watches: number;
  sessionsUpserted: number;
  seatmapsFetched: number;
  errors: SweepError[];
}
