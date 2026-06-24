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
export function scoreSeat(seat: Seat, map: SeatMap, pref?: SeatPreference): number {
  const targetDepth = pref?.targetDepth ?? 0.65;
  let depthWeight = pref?.depthWeight ?? 0.5;
  let centralityWeight = pref?.centralityWeight ?? 0.5;
  const avoidPaired = pref?.avoidPaired ?? false;
  const allowedAreaKinds = pref?.allowedAreaKinds;

  // Gate: availability, area kind, paired.
  if (seat.status !== "available") return 0;
  if (allowedAreaKinds && allowedAreaKinds.length > 0) {
    const kind = areaKind(map, seat.areaId);
    if (kind === undefined || !allowedAreaKinds.includes(kind)) return 0;
  }
  if (avoidPaired && seat.paired) return 0;

  // Real seats only (drop spacers) for geometry.
  const realSeats = map.seats.filter((s) => s.status !== "spacer");

  // Depth penalty over [minRow, maxRow] of real seats.
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const s of realSeats) {
    if (s.row < minRow) minRow = s.row;
    if (s.row > maxRow) maxRow = s.row;
  }
  const rowSpan = maxRow - minRow;
  const depth = rowSpan === 0 ? targetDepth : (seat.row - minRow) / rowSpan;
  const depthPenalty = Math.abs(depth - targetDepth);

  // Centrality penalty within the seat's own row (real seats only).
  let minCol = Infinity;
  let maxCol = -Infinity;
  for (const s of realSeats) {
    if (s.row !== seat.row) continue;
    if (s.col < minCol) minCol = s.col;
    if (s.col > maxCol) maxCol = s.col;
  }
  const centre = (minCol + maxCol) / 2;
  const halfWidth = (maxCol - minCol) / 2;
  const centralityPenalty = halfWidth === 0 ? 0 : Math.abs(seat.col - centre) / halfWidth;

  // Normalise weights.
  const totalWeight = depthWeight + centralityWeight;
  if (totalWeight === 0) {
    depthWeight = 0.5;
    centralityWeight = 0.5;
  } else {
    depthWeight = depthWeight / totalWeight;
    centralityWeight = centralityWeight / totalWeight;
  }

  const penalty = depthWeight * depthPenalty + centralityWeight * centralityPenalty;
  const score = Math.round(100 * (1 - penalty));
  return Math.max(0, Math.min(100, score));
}

/** Resolve a seat's normalised area kind via the map's area list. */
function areaKind(map: SeatMap, areaId: string): SeatArea["kind"] | undefined {
  return map.areas.find((a) => a.id === areaId)?.kind;
}

/**
 * Score every available seat in a map and return them best-first.
 */
export function rankSeats(map: SeatMap, pref?: SeatPreference): ScoredSeat[] {
  return map.seats
    .filter((seat) => seat.status === "available")
    .map((seat) => ({ seat, score: scoreSeat(seat, map, pref) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Best single seat score for a session - used to rank sessions against each other.
 */
export function bestSeatScore(map: SeatMap, pref?: SeatPreference): number {
  const ranked = rankSeats(map, pref);
  return ranked.length > 0 ? ranked[0]!.score : 0;
}
