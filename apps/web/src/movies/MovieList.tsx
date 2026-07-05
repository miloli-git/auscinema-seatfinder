import { useMemo, useState } from "react";
import { chainLabel } from "../format";
import { groupTitles, matchesSearch } from "./grouping";
import type { CatalogTitle } from "./types";

interface Props {
  titles: CatalogTitle[];
  onSelect: (movieKey: string) => void;
}

/**
 * Screen 0 — the movie list. Text search narrows the SAME list (one surface, not a separate
 * search/browse toggle): movie-first is primary, browse is co-equal (contract §"one single
 * surface"). Trivially-equal titles across chains are grouped visually; a picker row still
 * resolves to one specific chain's movieKey (contract §3).
 */
export function MovieList({ titles, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupTitles(titles), [titles]);
  const visible = useMemo(() => groups.filter((g) => matchesSearch(g, query)), [groups, query]);

  return (
    <div className="movielist">
      <label className="field movielist__search">
        <span>See a film, well.</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a film…"
          autoFocus
          aria-label="Search a film"
        />
      </label>

      {titles.length === 0 && <div className="empty">No cached titles yet.</div>}

      {titles.length > 0 && visible.length === 0 && (
        <div className="empty">No titles match &ldquo;{query}&rdquo;.</div>
      )}

      {visible.length > 0 && (
        <ul className="movielist__grid">
          {visible.map((group) => (
            <li key={group.key} className="movielist__row">
              {group.entries.length === 1 ? (
                <button
                  type="button"
                  className="movielist__item"
                  onClick={() => onSelect(group.entries[0]!.movieKey)}
                >
                  <span className="movielist__title">
                    {group.displayTitle.trim() || `(untitled — ${group.entries[0]!.movieKey})`}
                  </span>
                  <span className="movielist__sub">
                    {chainLabel(group.entries[0]!.chain)} · {group.entries[0]!.sessionCount} session
                    {group.entries[0]!.sessionCount === 1 ? "" : "s"}
                  </span>
                </button>
              ) : (
                <div className="movielist__group">
                  <span className="movielist__title">
                    {group.displayTitle.trim() || "(untitled)"}
                  </span>
                  <div className="movielist__chainpicker">
                    {group.entries.map((entry) => (
                      <button
                        type="button"
                        key={entry.movieKey}
                        className="chip"
                        onClick={() => onSelect(entry.movieKey)}
                      >
                        {chainLabel(entry.chain)} · {entry.sessionCount}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
