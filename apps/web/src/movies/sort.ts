// Screen 0 list sort (movielist-posters-sort brief): "Most sessions" (default) vs "A-Z". Pure
// sorting over TitleGroup[] so the ordering itself is independently unit-testable, separate from
// MovieList's rendering.

import type { TitleGroup } from "./grouping";

export type SortMode = "sessions" | "az";

/** Total sessionCount across a group's entries — the "most sessions" sort key for multi-chain rows. */
export function groupSessionCount(group: TitleGroup): number {
  return group.entries.reduce((sum, e) => sum + e.sessionCount, 0);
}

/**
 * Sort groups by mode. "sessions" (default): total sessionCount descending, ties broken by title
 * (stable, alphabetical) so equal-count rows don't reshuffle on every render. "az": displayTitle
 * ascending, case-insensitive.
 */
export function sortGroups(groups: readonly TitleGroup[], mode: SortMode): TitleGroup[] {
  const copy = [...groups];
  if (mode === "az") {
    copy.sort((a, b) => a.displayTitle.toLowerCase().localeCompare(b.displayTitle.toLowerCase()));
    return copy;
  }
  copy.sort((a, b) => {
    const diff = groupSessionCount(b) - groupSessionCount(a);
    if (diff !== 0) return diff;
    return a.displayTitle.toLowerCase().localeCompare(b.displayTitle.toLowerCase());
  });
  return copy;
}
