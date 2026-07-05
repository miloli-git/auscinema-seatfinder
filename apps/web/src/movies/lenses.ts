// Lens sort semantics per docs/47a-contract.md §1.5/§1.6. Only "together" trusts server order
// untouched; the other three are one-line client comparators over fields already in the payload.

import type { Option } from "./types";

export type Lens = "together" | "seats" | "screen" | "soonest";

export const LENSES: { value: Lens; label: string }[] = [
  { value: "together", label: "Most together" },
  { value: "seats", label: "Best seats" },
  { value: "screen", label: "Best screen" },
  { value: "soonest", label: "Soonest good" },
];

/** bestBlockScore desc, nulls last (split rows sink) — shared by "seats" and "screen". */
function byScoreDesc(a: Option, b: Option): number {
  if (a.bestBlockScore === b.bestBlockScore) return 0;
  if (a.bestBlockScore === null) return 1;
  if (b.bestBlockScore === null) return -1;
  return b.bestBlockScore - a.bestBlockScore;
}

export interface LensResult {
  options: Option[];
  /** True when the "soonest" lens's own qualifying filter is empty and it fell back to the full
   *  list — the honest "no great seats" state applies (contract §1.6). */
  noQualifying: boolean;
}

/**
 * Apply a lens to a server-ordered `options` array. Never mutates the input.
 * "together" MUST return the array untouched (not even a shallow-copy re-sort) — the server's
 * default order IS the "most together" ranking (contract §1.5/§1.6).
 */
export function applyLens(options: Option[], lens: Lens): LensResult {
  switch (lens) {
    case "together":
      return { options, noQualifying: false };
    case "seats":
      return { options: [...options].sort(byScoreDesc), noQualifying: false };
    case "screen":
      return {
        options: [...options].sort((a, b) => {
          if (b.formatRank !== a.formatRank) return b.formatRank - a.formatRank;
          return byScoreDesc(a, b);
        }),
        noQualifying: false,
      };
    case "soonest": {
      // 47c fix #9: this used to silently DROP non-qualifying rows from the list — a lens is
      // supposed to be a pure re-rank of the same candidate set (contract §1.6's own framing,
      // "tradeoff dials over the same candidates"), and "sounds like a sort, behaves like a filter"
      // was called out as surprising. Now: qualifying rows sort first (soonest first), then
      // non-qualifying rows follow (also soonest first) — every row from the input is still present,
      // just re-ordered. `noQualifying` keeps its existing meaning (zero rows qualify anywhere),
      // which still drives the same honest-state banner as before.
      const byStartsAt = (a: Option, b: Option): number => a.startsAt.localeCompare(b.startsAt);
      const qualifying = options.filter((o) => o.bestBlockScore !== null).sort(byStartsAt);
      const nonQualifying = options.filter((o) => o.bestBlockScore === null).sort(byStartsAt);
      return {
        options: [...qualifying, ...nonQualifying],
        noQualifying: qualifying.length === 0,
      };
    }
  }
}
