/**
 * Sellable-capacity predicate (GitHub issue #49 lesson, shared by the live lead-time CLI, the
 * ingester's write path, and anything else that needs "how many seats could the public ever
 * occupy here").
 *
 * A seat counts toward sellable capacity if it's a real seat the public could occupy: available,
 * sold, OR unavailable. Event releases far-future houses in waves and maps both taken AND
 * not-yet-released seats to `unavailable` (its raw "Sold" status is rare for advance sales), so
 * counting only available+sold would treat a barely-released house as empty (the soldPct=0 bug).
 * Spacers and companion/special allocations are structural/non-general-sale and excluded.
 */
import type { SeatStatus } from "./types.js";

export function isSeatable(status: SeatStatus): boolean {
  return status === "available" || status === "sold" || status === "unavailable";
}
