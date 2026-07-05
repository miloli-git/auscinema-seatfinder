import { describe, expect, it } from "vitest";
import { findAdjacentBlocks as webFindAdjacentBlocks, type BlockSeat } from "./blocks";
// Direct source import of the mirrored original — apps/web deliberately has no package dependency
// on @auscinema/core (see types.ts's "local mirror" rationale), but the web tsconfig's
// allowImportingTsExtensions + Bundler resolution lets this TEST reach the core source file
// relatively, so the mirror is enforced by CI rather than by convention.
import { findAdjacentBlocks as coreFindAdjacentBlocks } from "../../../packages/core/src/blocks.ts";

/**
 * #46 review follow-up (PR #85): apps/web/src/blocks.ts is a hand-copied mirror of
 * packages/core/src/blocks.ts. Nothing but this test enforces that they stay behaviourally
 * identical — any future change to the core adjacency algorithm that is not copied into the web
 * mirror (or vice versa) must fail here, on the exact fixture families the algorithm branches on:
 * column gaps, score ties, multi-row layouts, and spacer-adjacent (absent-column) seats.
 */

function seat(id: string, row: number, col: number, score: number, rowLabel = "R" + row): BlockSeat {
  return { id, rowLabel, row, col, score };
}

/** Named fixture layouts. Input is only the AVAILABLE seats (per the module contract): a missing
 *  column IS the sold-seat/aisle/spacer break, so "spacer-adjacent" means a col gap in the input. */
const LAYOUTS: Record<string, BlockSeat[]> = {
  "single contiguous row": [
    seat("A1", 0, 1, 90),
    seat("A2", 0, 2, 85),
    seat("A3", 0, 3, 80),
    seat("A4", 0, 4, 95),
  ],
  "row with a column gap (sold/aisle/spacer between col 2 and col 4)": [
    seat("A1", 0, 1, 90),
    seat("A2", 0, 2, 88),
    seat("A4", 0, 4, 92),
    seat("A5", 0, 5, 91),
  ],
  "avgScore ties across rows and start columns (tie-break: row, then startCol)": [
    // Two blocks of identical avg 80 in different rows, plus an equal-avg later window in row 0.
    seat("A1", 0, 1, 80),
    seat("A2", 0, 2, 80),
    seat("A5", 0, 5, 80),
    seat("A6", 0, 6, 80),
    seat("B1", 1, 1, 80),
    seat("B2", 1, 2, 80),
  ],
  "multi-row with below-threshold seats breaking runs": [
    seat("A1", 0, 1, 90),
    seat("A2", 0, 2, 40), // below any tested minScore >= 50 — breaks the run
    seat("A3", 0, 3, 91),
    seat("A4", 0, 4, 89),
    seat("B1", 1, 1, 75),
    seat("B2", 1, 2, 76),
    seat("B3", 1, 3, 77),
    seat("C7", 2, 7, 99),
  ],
  "spacer-adjacent seats: contiguous islands separated by absent columns": [
    seat("A1", 0, 1, 70),
    // cols 2-3 absent (spacers)
    seat("A4", 0, 4, 71),
    seat("A5", 0, 5, 72),
    // col 6 absent
    seat("A7", 0, 7, 73),
    seat("A8", 0, 8, 74),
    seat("A9", 0, 9, 60),
  ],
  "unsorted input order (algorithm must sort by col itself)": [
    seat("A3", 0, 3, 80),
    seat("A1", 0, 1, 82),
    seat("A2", 0, 2, 81),
    seat("B2", 1, 2, 95),
    seat("B1", 1, 1, 94),
  ],
  empty: [],
};

const OPTS = [
  { minScore: 50, size: 1 },
  { minScore: 50, size: 2 },
  { minScore: 74, size: 2 },
  { minScore: 74, size: 3 },
  { minScore: 90, size: 2 },
  { minScore: 74, size: 4 },
  { minScore: 74, size: 0 }, // degenerate: size < 1 returns []
  { minScore: 74, size: 2.9 }, // non-integer size is floored
];

describe("#46 web blocks.ts mirror stays in lockstep with core blocks.ts", () => {
  for (const [name, layout] of Object.entries(LAYOUTS)) {
    it(`produces identical output to core for: ${name}`, () => {
      for (const opts of OPTS) {
        // Fresh copies per call — both implementations sort in place; neither may see the
        // other's mutations.
        const webOut = webFindAdjacentBlocks(layout.map((s) => ({ ...s })), opts);
        const coreOut = coreFindAdjacentBlocks(layout.map((s) => ({ ...s })), opts);
        expect(webOut, `opts=${JSON.stringify(opts)}`).toEqual(coreOut);
      }
    });
  }

  it("sanity: the shared fixtures actually exercise non-empty output (not vacuously identical)", () => {
    const nonEmpty = Object.values(LAYOUTS).filter(
      (layout) => webFindAdjacentBlocks(layout.map((s) => ({ ...s })), { minScore: 74, size: 2 }).length > 0,
    );
    expect(nonEmpty.length).toBeGreaterThanOrEqual(3);
  });
});
