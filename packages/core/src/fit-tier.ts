/**
 * Together / Nearby / Split fit-tier algorithm (#47a contract §1.5) — a genuinely NEW algorithm, not
 * a port of `/together`'s existing logic (see contract §0: "There is no existing group-fit logic to
 * reuse for Nearby/Split"). Reuses `findAdjacentBlocks` exactly as `/together` does, but tries
 * decreasing sizes instead of only the exact `party` size.
 *
 * Algorithm (verbatim from the contract, both API and web builders test against this exact spec):
 *   1. Run findAdjacentBlocks(seats, { minScore, size: party }). If it returns >=1 block -> "together",
 *      togetherCount = party, bestBlockScore = that block's avgScore, bestBlockSize = party.
 *   2. Else, for size from party-1 down to 2, run findAdjacentBlocks(seats, { minScore, size }). The
 *      first size that returns >=1 block -> "nearby", togetherCount = size, bestBlockScore = that
 *      block's avgScore, bestBlockSize = size. (party === 1 skips this loop entirely.)
 *   3. Else (no run of 2+ found) -> "split", togetherCount = count of individual in-zone available
 *      seats (score >= minScore) capped at party, bestBlockScore = null, bestBlockSize = null.
 */
import { findAdjacentBlocks, type BlockSeat, type SeatBlock } from "./blocks.ts";

export type FitTier = "together" | "nearby" | "split";

export interface FitTierResult {
  fitTier: FitTier;
  togetherCount: number;
  bestBlockScore: number | null;
  bestBlockSize: number | null;
}

export function computeFitTier(seats: readonly BlockSeat[], minScore: number, party: number): FitTierResult {
  const size = Math.max(1, Math.floor(party));

  const togetherBlocks = findAdjacentBlocks(seats, { minScore, size });
  const togetherBlock: SeatBlock | undefined = togetherBlocks[0];
  if (togetherBlock) {
    return {
      fitTier: "together",
      togetherCount: size,
      bestBlockScore: togetherBlock.avgScore,
      bestBlockSize: size,
    };
  }

  for (let candidate = size - 1; candidate >= 2; candidate--) {
    const blocks = findAdjacentBlocks(seats, { minScore, size: candidate });
    const block = blocks[0];
    if (block) {
      return {
        fitTier: "nearby",
        togetherCount: candidate,
        bestBlockScore: block.avgScore,
        bestBlockSize: candidate,
      };
    }
  }

  const inZoneCount = seats.filter((s) => s.score >= minScore).length;
  return {
    fitTier: "split",
    togetherCount: Math.min(inZoneCount, size),
    bestBlockScore: null,
    bestBlockSize: null,
  };
}
