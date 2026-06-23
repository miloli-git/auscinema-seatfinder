import type { Seat, SeatMap, SeatArea } from "./types.js";

/** What the user considers a good seat. */
export interface SeatPreference {
  /**
   * Preferred viewing depth as a fraction of the auditorium from screen (0) to back (1).
   * ~0.6–0.7 is the usual "best" zone. Default 0.65.
   */
  targetDepth?: number;
  /** Weight on centrality (being mid-row). 0..1, default 0.5. */
  centralityWeight?: number;
  /** Weight on hitting target depth. 0..1, default 0.5. */
  depthWeight?: number;
  /** If set, only seats in these area `kind`s score above zero (e.g. ["recliner"]). */
  allowedAreaKinds?: SeatArea["kind"][];
  /** Avoid paired/couple seats when seated solo. Default false. */
  avoidPaired?: boolean;
}

export interface ScoredSeat {
  seat: Seat;
  /** 0–100; higher is better. 0 for unavailable or filtered-out seats. */
  score: number;
}

/**
 * Score a single seat 0–100 against a preference, using the seat map for geometry
 * (row extent for depth, per-row column extent for centrality).
 *
 * TODO(core): implement. See docs/scoring.md for the intended model:
 *   - depth = normalise seat.row over [minRow, maxRow]; penalty = |depth - targetDepth|
 *   - centrality = distance of seat.col from that row's centre, normalised by row half-width
 *   - gate on status === "available" and allowedAreaKinds
 *   - combine weighted penalties -> 0..100
 */
export function scoreSeat(_seat: Seat, _map: SeatMap, _pref?: SeatPreference): number {
  throw new Error("scoreSeat: not implemented");
}

/**
 * Score every available seat in a map and return them best-first.
 * TODO(core): implement on top of scoreSeat.
 */
export function rankSeats(_map: SeatMap, _pref?: SeatPreference): ScoredSeat[] {
  throw new Error("rankSeats: not implemented");
}

/**
 * Best single seat score for a session — used to rank sessions against each other.
 * TODO(core): implement (max of rankSeats, or 0 if none available).
 */
export function bestSeatScore(_map: SeatMap, _pref?: SeatPreference): number {
  throw new Error("bestSeatScore: not implemented");
}
