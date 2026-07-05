// Trivial-equality title grouping for Screen 0 (contract §3): display-only, never changes a
// movieKey. Grouped rows still carry their own distinct movieKeys — picking a grouped title still
// means picking one specific chain's option.

import type { CatalogTitle } from "./types";

/** trim, lowercase, collapse whitespace — no fuzzy matching, no punctuation stripping beyond that. */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface TitleGroup {
  /** normalized title, used only as the grouping key */
  key: string;
  /** first entry's raw title, used for display */
  displayTitle: string;
  entries: CatalogTitle[];
}

/** Groups titles that are trivially equal after normalization; everything else stays its own row. */
export function groupTitles(titles: CatalogTitle[]): TitleGroup[] {
  const groups = new Map<string, TitleGroup>();
  const order: string[] = [];
  for (const t of titles) {
    const key = normalizeTitle(t.title);
    let g = groups.get(key);
    if (!g) {
      g = { key, displayTitle: t.title, entries: [] };
      groups.set(key, g);
      order.push(key);
    }
    g.entries.push(t);
  }
  return order.map((k) => {
    const g = groups.get(k);
    if (!g) throw new Error(`unreachable: missing group for key ${k}`);
    return g;
  });
}

/** Case-insensitive substring match against a group's display title (Screen 0 text search). */
export function matchesSearch(group: TitleGroup, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return group.displayTitle.toLowerCase().includes(q);
}
