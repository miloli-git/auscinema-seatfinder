// Local mirror of the wire shapes the API returns. Kept independent of
// @auscinema/core so the web build does not couple to the package graph.
// Source of truth: packages/core/src/types.ts and packages/core/src/scoring.ts.

export type Chain = "event" | "hoyts" | "reading" | "village";

export interface Cinema {
  chain: Chain;
  id: string;
  name: string;
  region?: string;
  url?: string;
}

/** GET /movies response item = a distinct movie playing at the cinema/date. */
export interface Movie {
  id: string;
  name: string;
}

export interface ScreenFormat {
  kind: "standard" | "premium" | "goldclass" | "imax" | "vmax" | "other";
  raw: string;
}

export interface Session {
  chain: Chain;
  id: string;
  movieId: string;
  movieName: string;
  cinemaId: string;
  cinemaName: string;
  startTime: string;
  format: ScreenFormat;
  screenName?: string;
  seatsAvailable?: number;
  seatAllocation: boolean;
  bookingUrl: string;
  attributes?: string[];
}

export type SeatStatus =
  | "available"
  | "sold"
  | "spacer"
  | "companion"
  | "special"
  | "unavailable";

export type AreaKind =
  | "standard"
  | "recliner"
  | "premium"
  | "goldclass"
  | "daybed"
  | "companion"
  | "other";

export interface SeatArea {
  id: string;
  name: string;
  code?: string;
  kind: AreaKind;
}

export interface Seat {
  id: string;
  name?: string;
  rowLabel: string;
  row: number;
  col: number;
  status: SeatStatus;
  areaId: string;
  paired?: boolean;
  premium?: boolean;
  accessible?: boolean;
}

export interface SeatMap {
  chain: Chain;
  sessionId: string;
  screenName?: string;
  areas: SeatArea[];
  seats: Seat[];
}

export interface ScoredSeat {
  seat: Seat;
  score: number;
}

/** GET /seatmap response = SeatMap + the scored available seats. */
export interface ScoredSeatMap extends SeatMap {
  scored: ScoredSeat[];
}

export interface RankedSession {
  session: Session;
  bestScore: number;
  bookingUrl: string;
  topSeats: ScoredSeat[];
}

export interface BestResponse {
  sessions: RankedSession[];
  skipped: { sessionId: string; reason: string }[];
}

/** Allowed area-class filter values (subset users care about). */
export const SELECTABLE_AREA_KINDS: AreaKind[] = [
  "standard",
  "recliner",
  "premium",
  "goldclass",
  "daybed",
];
