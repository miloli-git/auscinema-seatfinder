import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCatalogTitles, fetchOptions } from "./api";
import { AvailabilitySummary } from "./AvailabilitySummary";
import { ContextBar, type DayCount } from "./ContextBar";
import { MovieList } from "./MovieList";
import { OptionList } from "./OptionList";
import { OptionSeatMapPanel } from "./OptionSeatMapPanel";
import type { CatalogTitle, Option, OptionsResponse } from "./types";

const DEFAULT_PARTY = 2;
const DEFAULT_MIN_SCORE = 74;

type CatalogState =
  | { status: "loading" }
  | { status: "ready"; titles: CatalogTitle[] }
  | { status: "error"; error: string };

type OptionsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: OptionsResponse }
  | { status: "error"; error: string };

function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Top-level orchestrator for the movie-first entry (#47a). No client-side router in this app
 * (App.tsx drives mode purely via component state) — this becomes the new default `mode`, with the
 * old two-tab UI unretired and reachable via its own tab (App.tsx).
 *
 * Screen 0 (movie list) -> pick a movie -> Screen 1 (context bar + lens option list) -> tap an
 * option -> seat-map hero + booking CTA (existing components, wiring only).
 */
export function MovieFirstView() {
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [movieKey, setMovieKey] = useState<string | null>(null);
  const [movieTitle, setMovieTitle] = useState<string>("");

  const [groupMode, setGroupMode] = useState(false);
  const [soloParty, setSoloParty] = useState(DEFAULT_PARTY);
  const [minScore, setMinScore] = useState(DEFAULT_MIN_SCORE);
  const [dayCounts, setDayCounts] = useState<Map<string, number>>(new Map());
  // Dates seen across ANY /options response for the current movie, accumulated (never reset by a
  // refetch's transient "loading" state) so the per-day steppers don't flicker/unmount every time a
  // stepper edit triggers a new /options call — only a movie change clears this.
  const [knownDates, setKnownDates] = useState<string[]>([]);

  const [optionsState, setOptionsState] = useState<OptionsState>({ status: "idle" });
  const [selectedOption, setSelectedOption] = useState<Option | null>(null);

  const reqRef = useRef(0);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    fetchCatalogTitles()
      .then((titles) => {
        if (live) setCatalog({ status: "ready", titles });
      })
      .catch((err: unknown) => {
        if (live) setCatalog({ status: "error", error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      live = false;
    };
  }, []);

  // Effective party sent to /options: solo mode uses the single stepper; group mode uses the max
  // of the entered per-day counts (contract §1.2's own recommendation — the binding constraint for
  // "most together"). Per-day ranking is never implied.
  const effectiveParty = useMemo(() => {
    if (!groupMode) return soloParty;
    if (dayCounts.size === 0) return soloParty;
    return Math.max(...dayCounts.values());
  }, [groupMode, soloParty, dayCounts]);

  useEffect(() => {
    if (!movieKey) {
      setOptionsState({ status: "idle" });
      return;
    }
    let live = true;
    const token = ++reqRef.current;
    setOptionsState({ status: "loading" });
    fetchOptions({ movieKey, party: effectiveParty, minScore })
      .then((data) => {
        if (!live || reqRef.current !== token) return;
        setOptionsState({ status: "ready", data });
        setMovieTitle(data.movieTitle);
        // Seed one stepper per distinct cached day, defaulting new days to the solo party size.
        setDayCounts((prev) => {
          const next = new Map(prev);
          for (const o of data.options) {
            if (!next.has(o.date)) next.set(o.date, soloParty);
          }
          return next;
        });
        setKnownDates((prev) => {
          const next = new Set(prev);
          for (const o of data.options) next.add(o.date);
          return [...next].sort();
        });
      })
      .catch((err: unknown) => {
        if (!live || reqRef.current !== token) return;
        setOptionsState({ status: "error", error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      live = false;
    };
    // soloParty is intentionally excluded — it only seeds NEW days, refetching on every solo-party
    // edit while in group mode would fight the "single scalar" model; effectiveParty covers that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieKey, effectiveParty, minScore]);

  const days: DayCount[] = useMemo(
    () =>
      knownDates.map((date) => ({
        date,
        label: dayLabel(date),
        count: dayCounts.get(date) ?? soloParty,
      })),
    [knownDates, dayCounts, soloParty],
  );

  const selectMovie = (key: string) => {
    setMovieKey(key);
    setMovieTitle("");
    setSelectedOption(null);
    setDayCounts(new Map());
    setKnownDates([]);
    setGroupMode(false);
  };

  const backToList = () => {
    reqRef.current++; // drop any in-flight /options for the movie we're leaving
    setMovieKey(null);
    setOptionsState({ status: "idle" });
    setSelectedOption(null);
  };

  const skipToResults = () => {
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!movieKey) {
    if (catalog.status === "loading") return <div className="empty">Loading titles…</div>;
    if (catalog.status === "error") {
      return (
        <div className="banner banner--error" role="alert">
          <strong>Couldn&rsquo;t load the movie list.</strong> {catalog.error}
        </div>
      );
    }
    return <MovieList titles={catalog.titles} onSelect={selectMovie} />;
  }

  return (
    <div className="movieforward">
      <div className="movieforward__head">
        <button type="button" className="btn btn--ghost" onClick={backToList}>
          ← Movies
        </button>
        <h2 className="movieforward__title">{movieTitle || movieKey}</h2>
      </div>

      <AvailabilitySummary movieKey={movieKey} party={effectiveParty} minScore={minScore} />

      <ContextBar
        groupMode={groupMode}
        onToggleGroupMode={setGroupMode}
        soloParty={soloParty}
        onSoloPartyChange={setSoloParty}
        minScore={minScore}
        onMinScoreChange={setMinScore}
        days={days}
        onDayCountChange={(date, count) =>
          setDayCounts((prev) => new Map(prev).set(date, count))
        }
        onSkipToResults={skipToResults}
      />

      <div ref={resultsRef}>
        {optionsState.status === "loading" && <div className="empty">Finding options…</div>}
        {optionsState.status === "error" && (
          <div className="banner banner--error" role="alert">
            <strong>Couldn&rsquo;t load options.</strong> {optionsState.error}
          </div>
        )}
        {optionsState.status === "ready" && (
          <OptionList
            options={optionsState.data.options}
            party={effectiveParty}
            selectedSessionId={selectedOption?.sessionId ?? null}
            onSelectOption={setSelectedOption}
          />
        )}
      </div>

      {selectedOption && (
        <OptionSeatMapPanel
          option={selectedOption}
          movieKey={movieKey}
          party={effectiveParty}
          minScore={minScore}
          onClose={() => setSelectedOption(null)}
        />
      )}
    </div>
  );
}
