import { useEffect, useMemo, useRef, useState } from "react";
import { formatShortDate } from "../format";
import { useDebouncedValue } from "../useDebouncedValue";
import { fetchCatalogTitles, fetchOptions } from "./api";
import { AvailabilitySummary } from "./AvailabilitySummary";
import { ContextBar, type DayCount } from "./ContextBar";
import { groupDatesByParty, mergeGroupOptions } from "./groupOptions";
import { MovieList } from "./MovieList";
import { OptionList } from "./OptionList";
import { OptionSeatMapPanel } from "./OptionSeatMapPanel";
import type { CatalogTitle, Option, OptionsResponse } from "./types";

// 47c fix #7: "Just me" now means party 1 (label-honest) — the solo default used to be 2, which
// directly contradicted the "Just me" label. Group mode keeps its own floor at 2 (a "group" of 1
// isn't a group); the two are separate constants precisely so changing one never silently drifts
// the other.
const DEFAULT_SOLO_PARTY = 1;
const DEFAULT_GROUP_DAY_COUNT = 2;
const DEFAULT_MIN_SCORE = 74;
// 47c fix #6: fetch-triggering effects key off the DEBOUNCED copy of minScore/soloParty/dayCounts,
// not the raw per-keystroke/per-drag-pixel value — see useDebouncedValue's own doc comment.
const DEBOUNCE_MS = 350;

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
  return formatShortDate(date);
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
  const [soloParty, setSoloParty] = useState(DEFAULT_SOLO_PARTY);
  const [minScore, setMinScore] = useState(DEFAULT_MIN_SCORE);
  const [dayCounts, setDayCounts] = useState<Map<string, number>>(new Map());
  // Dates seen across ANY /options response for the current movie, accumulated (never reset by a
  // refetch's transient "loading" state) so the per-day steppers don't flicker/unmount every time a
  // stepper edit triggers a new /options call — only a movie change clears this.
  const [knownDates, setKnownDates] = useState<string[]>([]);
  // 47c fixes #2/#5: lifted here (not local to OptionList) so a DateAvailabilityStrip cell click in
  // the booking-detail panel (a sibling of the option list) can drive the same filter.
  const [dayFilter, setDayFilter] = useState<string | null>(null);

  const [optionsState, setOptionsState] = useState<OptionsState>({ status: "idle" });
  const [selectedOption, setSelectedOption] = useState<Option | null>(null);

  const reqRef = useRef(0);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  // 47c fix #6: debounced copies feed every fetch-triggering effect/prop below; the raw state above
  // still drives the immediately-responsive UI (slider position, stepper counts, displayed labels).
  const debouncedMinScore = useDebouncedValue(minScore, DEBOUNCE_MS);
  const debouncedSoloParty = useDebouncedValue(soloParty, DEBOUNCE_MS);
  const debouncedDayCounts = useDebouncedValue(dayCounts, DEBOUNCE_MS);

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

  // Effective party for display/summary purposes: solo mode uses the single stepper; group mode
  // uses the max of the entered per-day counts (still the binding constraint for the header
  // summary / seat-map party, since those are single-scalar consumers) — but 47c fix #3 means the
  // OPTION LIST itself no longer uses this single number for every card; see the fetch effect below.
  const debouncedEffectiveParty = useMemo(() => {
    if (!groupMode) return debouncedSoloParty;
    if (debouncedDayCounts.size === 0) return DEFAULT_GROUP_DAY_COUNT;
    return Math.max(...debouncedDayCounts.values());
  }, [groupMode, debouncedSoloParty, debouncedDayCounts]);

  // A stable primitive signature of debouncedDayCounts, but ONLY when it's actually query-relevant
  // (group mode). In solo mode this stays a constant "" regardless of dayCounts churn — dayCounts is
  // seeded in the background even in solo mode (so it's ready if the user later flips to group mode),
  // and without this guard that seeding alone would retrigger the /options fetch effect below via a
  // dayCounts reference change that has zero bearing on the solo query actually sent.
  const groupDayCountsSignature = useMemo(() => {
    if (!groupMode) return "";
    return [...debouncedDayCounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => `${date}:${count}`)
      .join(",");
  }, [groupMode, debouncedDayCounts]);

  useEffect(() => {
    if (!movieKey) {
      setOptionsState({ status: "idle" });
      return;
    }
    let live = true;
    const token = ++reqRef.current;
    setOptionsState({ status: "loading" });

    const seedDays = (options: Option[]): void => {
      setDayCounts((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const o of options) {
          if (!next.has(o.date)) {
            next.set(o.date, DEFAULT_GROUP_DAY_COUNT);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setKnownDates((prev) => {
        const seen = new Set(prev);
        let changed = false;
        for (const o of options) {
          if (!seen.has(o.date)) {
            seen.add(o.date);
            changed = true;
          }
        }
        return changed ? [...seen].sort() : prev;
      });
    };

    // 47c fix #3: group mode with at least one per-day headcount known fans out one /options call
    // per DISTINCT headcount value (few in practice) and merges honestly — see groupOptions.ts.
    // Solo mode, and group mode before any day counts are seeded yet, use a single direct fetch.
    const run = async (): Promise<{
      movieTitle: string;
      options: Option[];
      freshness: OptionsResponse["freshness"];
    }> => {
      if (!groupMode || debouncedDayCounts.size === 0) {
        const data = await fetchOptions({ movieKey, party: debouncedEffectiveParty, minScore: debouncedMinScore });
        return {
          movieTitle: data.movieTitle,
          options: data.options.map((o) => ({ ...o, effectiveParty: debouncedEffectiveParty })),
          freshness: data.freshness,
        };
      }
      const groups = groupDatesByParty(debouncedDayCounts);
      const results = await Promise.all(
        groups.map(async (group) => ({
          group,
          data: await fetchOptions({ movieKey, party: group.party, minScore: debouncedMinScore }),
        })),
      );
      const merged = mergeGroupOptions(results);
      return { movieTitle: merged.movieTitle, options: merged.options, freshness: merged.freshness };
    };

    run()
      .then(({ movieTitle: title, options, freshness }) => {
        if (!live || reqRef.current !== token) return;
        setOptionsState({
          status: "ready",
          data: {
            movieKey,
            movieTitle: title,
            party: debouncedEffectiveParty,
            minScore: debouncedMinScore,
            count: options.length,
            options,
            freshness,
          },
        });
        setMovieTitle(title);
        seedDays(options);
      })
      .catch((err: unknown) => {
        if (!live || reqRef.current !== token) return;
        setOptionsState({ status: "error", error: err instanceof Error ? err.message : String(err) });
      });

    return () => {
      live = false;
    };
    // debouncedDayCounts is intentionally excluded in favour of groupDayCountsSignature — see that
    // memo's own comment: including the Map directly would retrigger this effect on solo-mode
    // background seeding, which has no bearing on the solo query actually sent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieKey, groupMode, debouncedEffectiveParty, debouncedMinScore, groupDayCountsSignature]);

  const days: DayCount[] = useMemo(
    () =>
      knownDates.map((date) => ({
        date,
        label: dayLabel(date),
        count: dayCounts.get(date) ?? DEFAULT_GROUP_DAY_COUNT,
      })),
    [knownDates, dayCounts],
  );

  const selectMovie = (key: string) => {
    setMovieKey(key);
    setMovieTitle("");
    setSelectedOption(null);
    setDayCounts(new Map());
    setKnownDates([]);
    setGroupMode(false);
    setDayFilter(null);
  };

  const backToList = () => {
    reqRef.current++; // drop any in-flight /options for the movie we're leaving
    setMovieKey(null);
    setOptionsState({ status: "idle" });
    setSelectedOption(null);
  };

  const skipToResults = () => {
    // Optional call, not just optional chaining on the ref: jsdom (the test environment) doesn't
    // implement scrollIntoView at all, so a plain `?.scrollIntoView(...)` still throws there.
    resultsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  // 47c fix #5: a DateAvailabilityStrip cell click (in the booking-detail panel below) applies that
  // date as the option list's day filter and scrolls back up to it — a real action, not an inert cell.
  const selectDateFromStrip = (date: string) => {
    setDayFilter(date);
    skipToResults();
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

      <AvailabilitySummary movieKey={movieKey} party={debouncedEffectiveParty} minScore={debouncedMinScore} />

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
            party={debouncedEffectiveParty}
            groupMode={groupMode}
            selectedSessionId={selectedOption?.sessionId ?? null}
            onSelectOption={setSelectedOption}
            dayFilter={dayFilter}
            onDayFilterChange={setDayFilter}
          />
        )}
      </div>

      {selectedOption && (
        <OptionSeatMapPanel
          option={selectedOption}
          movieKey={movieKey}
          party={debouncedEffectiveParty}
          minScore={debouncedMinScore}
          onClose={() => setSelectedOption(null)}
          onSelectDate={selectDateFromStrip}
        />
      )}
    </div>
  );
}
