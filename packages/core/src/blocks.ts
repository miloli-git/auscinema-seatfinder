/**
 * Adjacency search for the "Seats Together" feature: given the available, scored seats of a
 * session, find blocks of N seats that are contiguous in a row AND all in-zone (score >= minScore).
 *
 * Geometry-agnostic: it walks by ascending `col`, so a break is either a column gap (a sold seat or
 * an aisle - neither is present in the input) or a seat below the score threshold. This works for
 * true-coordinate chains (Event/Reading/Village) and for Hoyts' index-order columns alike, with the
 * usual caveat that Hoyts adjacency is approximate (array order, not measured seats).
 *
 * Input is intentionally only the AVAILABLE seats (sold seats are absent, which is exactly what makes
 * a missing column read as a break). Scores stay per-seat so party size and minScore are tunable at
 * query time without re-fetching.
 */

/** Minimal per-seat info the adjacency walk needs. */
export interface BlockSeat {
  id: string;
  rowLabel: string;
  /** Normalised coords: higher row = further back; col increases left->right. */
  row: number;
  col: number;
  /** 0-100 quality score for this seat. */
  score: number;
}

export interface SeatBlock {
  row: number;
  rowLabel: string;
  startCol: number;
  /** Seat ids in left->right order; length === requested size. */
  seatIds: string[];
  /** Mean score across the block, rounded. */
  avgScore: number;
  /** Lowest seat score in the block (every seat is >= the requested minScore). */
  minScore: number;
}

export interface BlockOptions {
  /** Minimum per-seat score to count as in-zone. */
  minScore: number;
  /** Party size: number of adjacent in-zone seats required (>= 1). */
  size: number;
}

/**
 * Find the best contiguous, all-in-zone block of `size` seats per run, across all rows.
 * Returns blocks sorted best-first (avgScore desc, then row, then startCol). Empty when no row has
 * a qualifying run.
 */
export function findAdjacentBlocks(seats: readonly BlockSeat[], opts: BlockOptions): SeatBlock[] {
  const size = Math.floor(opts.size);
  if (size < 1 || seats.length === 0) return [];

  // Group by row.
  const byRow = new Map<number, BlockSeat[]>();
  for (const s of seats) {
    let arr = byRow.get(s.row);
    if (!arr) {
      arr = [];
      byRow.set(s.row, arr);
    }
    arr.push(s);
  }

  const blocks: SeatBlock[] = [];
  for (const rowSeats of byRow.values()) {
    rowSeats.sort((a, b) => a.col - b.col);

    // Build maximal runs of in-zone seats with strictly contiguous columns.
    let run: BlockSeat[] = [];
    const flush = () => {
      if (run.length >= size) blocks.push(bestWindow(run, size, opts.minScore));
      run = [];
    };
    for (const seat of rowSeats) {
      if (seat.score < opts.minScore) {
        flush(); // below-zone seat breaks the run and starts nothing
        continue;
      }
      const prev = run[run.length - 1];
      if (prev && seat.col === prev.col + 1) {
        run.push(seat); // contiguous: extend
      } else {
        flush(); // gap (sold/aisle) or first: start a fresh run at this seat
        run = [seat];
      }
    }
    flush();
  }

  blocks.sort((a, b) => b.avgScore - a.avgScore || a.row - b.row || a.startCol - b.startCol);
  return blocks;
}

/** Pick the highest-average window of length `size` within a single contiguous in-zone run. */
function bestWindow(run: readonly BlockSeat[], size: number, minScore: number): SeatBlock {
  let best = 0;
  let bestSum = -1;
  for (let i = 0; i + size <= run.length; i++) {
    let sum = 0;
    for (let j = i; j < i + size; j++) sum += run[j]!.score;
    if (sum > bestSum) {
      bestSum = sum;
      best = i;
    }
  }
  const window = run.slice(best, best + size);
  let min = Infinity;
  for (const s of window) if (s.score < min) min = s.score;
  return {
    row: window[0]!.row,
    rowLabel: window[0]!.rowLabel,
    startCol: window[0]!.col,
    seatIds: window.map((s) => s.id),
    avgScore: Math.round(bestSum / size),
    minScore: min,
  };
}
