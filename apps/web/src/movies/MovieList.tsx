import { useMemo, useState } from "react";
import { chainLabel } from "../format";
import { groupTitles, matchesSearch, type TitleGroup } from "./grouping";
import { blockTextColor, blockTokenFor } from "./palette";
import { displayMovieTitle } from "./present";
import { sortGroups, type SortMode } from "./sort";
import type { CatalogTitle } from "./types";

interface Props {
  titles: CatalogTitle[];
  onSelect: (movieKey: string) => void;
}

/** CSS modifier suffix for a block token, e.g. "--block-crimson" -> "crimson". */
function blockModifier(token: ReturnType<typeof blockTokenFor>): string {
  return token.replace("--block-", "");
}

/** First non-null poster in a group — multi-chain rows use the first entry's poster (contract). */
function groupPosterUrl(group: TitleGroup): string | null {
  for (const e of group.entries) if (e.posterUrl) return e.posterUrl;
  return null;
}

/** Poster art box, or nothing — the caption block below fills the whole card when there's no art. */
function PosterArt({ url, alt }: { url: string | null; alt: string }) {
  if (!url) return null;
  return (
    <div className="postercard__art">
      <img src={url} alt={alt} loading="lazy" />
    </div>
  );
}

/**
 * Screen 0 — the movie list. Text search narrows the SAME list (one surface, not a separate
 * search/browse toggle): movie-first is primary, browse is co-equal (contract §"one single
 * surface"). Trivially-equal titles across chains are grouped visually; a picker row still
 * resolves to one specific chain's movieKey (contract §3).
 *
 * SOH poster-card design brief (design/iterations/extractions/soh-DESIGN.md "Cards and surfaces"):
 * poster on top, one saturated `block-*` colour caption underneath carrying the heavy title + meta
 * line. No poster in cache -> the colour block fills the whole card (placeholder spirit of the
 * brief's gradient/duotone note, without inventing fake artwork).
 */
export function MovieList({ titles, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("sessions");
  const groups = useMemo(() => groupTitles(titles), [titles]);
  const visible = useMemo(
    () => sortGroups(groups.filter((g) => matchesSearch(g, query)), sortMode),
    [groups, query, sortMode],
  );

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

      {titles.length > 0 && (
        <div className="movielist__sort" role="group" aria-label="Sort films">
          <button
            type="button"
            className={`movielist__sortbtn${sortMode === "sessions" ? " is-active" : ""}`}
            aria-pressed={sortMode === "sessions"}
            onClick={() => setSortMode("sessions")}
          >
            Most sessions
          </button>
          <button
            type="button"
            className={`movielist__sortbtn${sortMode === "az" ? " is-active" : ""}`}
            aria-pressed={sortMode === "az"}
            onClick={() => setSortMode("az")}
          >
            A–Z
          </button>
        </div>
      )}

      {titles.length === 0 && <div className="empty">No cached titles yet.</div>}

      {titles.length > 0 && visible.length === 0 && (
        <div className="empty">No titles match &ldquo;{query}&rdquo;.</div>
      )}

      {visible.length > 0 && (
        <ul className="movielist__grid">
          {visible.map((group) => {
            const posterUrl = groupPosterUrl(group);
            const token = blockTokenFor(group.key);
            const modifier = blockModifier(token);
            const textColor = blockTextColor(token);
            const captionClass =
              `postercard__caption postercard__caption--${modifier}` +
              (textColor === "ink" ? " postercard__caption--ink" : "");

            if (group.entries.length === 1) {
              const entry = group.entries[0]!;
              const title = displayMovieTitle(group.displayTitle, entry.chain);
              return (
                <li key={group.key} className="movielist__row">
                  <button
                    type="button"
                    className="postercard postercard--button"
                    onClick={() => onSelect(entry.movieKey)}
                  >
                    <PosterArt url={posterUrl} alt="" />
                    <div className={captionClass}>
                      {/* #84: a blank displayTitle used to fall back to the raw movieKey (e.g.
                          "hoyts:HO00010001") wrapped in "(untitled — …)" — still a raw id leaking
                          into the picker. Degrade to an honest, chain-scoped label instead. */}
                      <span className="postercard__title">{title}</span>
                      <span className="postercard__meta">
                        {chainLabel(entry.chain)} · {entry.sessionCount} session
                        {entry.sessionCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </button>
                </li>
              );
            }

            return (
              <li key={group.key} className="movielist__row">
                <div className="postercard">
                  <PosterArt url={posterUrl} alt="" />
                  <div className={captionClass}>
                    <span className="postercard__title">{group.displayTitle.trim() || "(untitled)"}</span>
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
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
