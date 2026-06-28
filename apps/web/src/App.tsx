import { useEffect, useMemo, useRef, useState } from "react";
import { QueryForm, DEFAULTS, type FormValues } from "./components/QueryForm";
import { SessionCard } from "./components/SessionCard";
import { SeatMapView } from "./components/SeatMapView";
import { TogetherView } from "./components/TogetherView";
import { fetchBest, fetchSeatMap, type ScoringParams, API_BASE } from "./api";
import type { BestResponse, ScoredSeatMap, Session } from "./types";
import { chainLabel, formatLabel, formatTime, largeFormatOnly, withinWindow } from "./format";

function scoringOf(v: FormValues): ScoringParams {
  return {
    targetDepth: v.targetDepth,
    depthWeight: v.depthWeight,
    centralityWeight: v.centralityWeight,
    allowedAreaKinds: v.allowedAreaKinds,
    avoidPaired: v.avoidPaired,
  };
}

type Mode = "best" | "together";

export function App() {
  const [mode, setMode] = useState<Mode>("together");
  const [values, setValues] = useState<FormValues>(DEFAULTS);
  const [result, setResult] = useState<BestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refineOpen, setRefineOpen] = useState(true);
  const [summary, setSummary] = useState("");
  const [largeOnly, setLargeOnly] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seatMap, setSeatMap] = useState<ScoredSeatMap | null>(null);
  const [seatLoading, setSeatLoading] = useState(false);
  const [seatError, setSeatError] = useState<string | null>(null);

  // Snapshot of the scoring used for the last search - seat maps reuse it.
  const [lastScoring, setLastScoring] = useState<ScoringParams>(scoringOf(DEFAULTS));
  const [lastTopN, setLastTopN] = useState(DEFAULTS.topN);

  const withinTime = useMemo(() => {
    if (!result) return [];
    return result.sessions.filter((r) => withinWindow(r.session, values.from, values.to));
  }, [result, values.from, values.to]);

  const visibleSessions = useMemo(
    () => largeFormatOnly(withinTime, largeOnly),
    [withinTime, largeOnly],
  );

  const selectedRanked = useMemo(
    () => visibleSessions.find((r) => r.session.id === selectedId) ?? null,
    [visibleSessions, selectedId],
  );

  // Sequence token for seat-map requests. Only the most recent open commits
  // seat state, so an older in-flight fetch can't overwrite a newer selection.
  const seatReqRef = useRef(0);

  // Load (or switch to) a session's seat map. Hero model: always select, never toggle closed.
  const openSession = async (session: Session, scoring: ScoringParams) => {
    if (selectedId === session.id) return;
    const token = ++seatReqRef.current;
    setSelectedId(session.id);
    setSeatMap(null);
    setSeatError(null);
    setSeatLoading(true);
    try {
      const map = await fetchSeatMap(session.chain, session.id, scoring);
      if (seatReqRef.current !== token) return;
      setSeatMap(map);
    } catch (err) {
      if (seatReqRef.current !== token) return;
      setSeatError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seatReqRef.current === token) setSeatLoading(false);
    }
  };

  // Reconcile selection whenever the visible set changes (e.g. toggling the
  // large-format filter). If the selected session is no longer visible, open
  // the first visible one; if none remain, clear selection + seat-map state.
  useEffect(() => {
    if (!result) return;
    const stillVisible =
      selectedId !== null && visibleSessions.some((r) => r.session.id === selectedId);
    if (stillVisible) return;
    const firstVisible = visibleSessions[0];
    if (firstVisible) {
      void openSession(firstVisible.session, lastScoring);
    } else if (selectedId !== null || seatMap !== null || seatError !== null || seatLoading) {
      seatReqRef.current++; // invalidate any in-flight seat fetch so it can't commit after clear
      setSelectedId(null);
      setSeatMap(null);
      setSeatError(null);
      setSeatLoading(false);
    }
    // openSession is stable in behaviour; intentionally excluded to avoid loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, visibleSessions, selectedId, lastScoring]);

  const runSearch = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    seatReqRef.current++; // abandon any in-flight seat fetch from the prior result
    setSelectedId(null);
    setSeatMap(null);
    setSeatError(null);
    setSeatLoading(false);
    const scoring = scoringOf(values);
    setLastScoring(scoring);
    setLastTopN(values.topN);
    try {
      const res = await fetchBest({
        chain: values.chain,
        movieId: values.movieId.trim(),
        cinemaIds: values.cinemaIds.trim(),
        date: values.date.trim(),
        topN: values.topN,
        ...scoring,
      });
      // Reset selection + seat state so the reconciliation effect is the sole
      // auto-select path. It derives the first visible session from the CURRENT
      // filters (largeOnly/time window), avoiding a stale-closure mis-select and
      // ensuring exactly one /seatmap fetch per search.
      setSelectedId(null);
      setSeatMap(null);
      setSeatError(null);
      setResult(res);
      setRefineOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const sel = selectedRanked?.session;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark">◐</span>
          <span className="brand__name">
            AusCinema <b>Seat Finder</b>
          </span>
        </div>
        <div className="modetoggle" role="tablist" aria-label="Search mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "together"}
            className={`btn btn--ghost${mode === "together" ? " btn--on" : ""}`}
            onClick={() => setMode("together")}
          >
            Seats together
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "best"}
            className={`btn btn--ghost${mode === "best" ? " btn--on" : ""}`}
            onClick={() => setMode("best")}
          >
            Best seat
          </button>
        </div>
        {mode === "best" && (
          <button
            type="button"
            className="btn btn--ghost"
            aria-expanded={refineOpen}
            onClick={() => setRefineOpen((o) => !o)}
          >
            <span className="crumb">{summary || "Set up a search"}</span>
            <span aria-hidden="true">· Refine {refineOpen ? "▴" : "▾"}</span>
          </button>
        )}
      </header>

      {mode === "together" && <TogetherView />}

      {mode === "best" && (
        <>
      <div className="refine" hidden={!refineOpen}>
        <QueryForm
          values={values}
          onChange={setValues}
          onSubmit={runSearch}
          loading={loading}
          onSummary={setSummary}
        />
        <label className="field field--check">
          <input
            type="checkbox"
            checked={largeOnly}
            onChange={(e) => setLargeOnly(e.target.checked)}
          />
          <span>Large format only</span>
        </label>
        <p className="api-base">API · {API_BASE || "same-origin (proxy)"}</p>
      </div>

      {error && (
        <div className="banner banner--error" role="alert">
          <strong>Search failed.</strong> {error}
        </div>
      )}

      {loading && <div className="empty">Searching sessions…</div>}

      {!loading && !result && !error && (
        <div className="empty">
          <p>
            <strong>Find a great seat.</strong>
          </p>
          <p className="hint">
            Pick a chain, one or more cinemas, a date and a movie above, then search. Every session is
            ranked by its best available seat, with a heat-mapped seat plan.
          </p>
        </div>
      )}

      {!loading && result && (
        <div className="stage">
          <section aria-label="Ranked sessions">
            <div className="rail__head">
              <h2>
                {visibleSessions.length} session{visibleSessions.length === 1 ? "" : "s"}
              </h2>
              <span className="sub">best seat, ranked</span>
            </div>
            {visibleSessions.length === 0 ? (
              <p className="hint">
                {largeOnly && withinTime.length > 0
                  ? "No large-format sessions match the current filters."
                  : "No sessions match the time window."}
              </p>
            ) : (
              <div className="rail">
                {visibleSessions.map((r) => (
                  <SessionCard
                    key={r.session.id}
                    ranked={r}
                    selected={selectedId === r.session.id}
                    onSelect={(s) => void openSession(s, lastScoring)}
                  />
                ))}
              </div>
            )}
            {result.skipped.length > 0 && (
              <p className="hint">{result.skipped.length} skipped (no seat allocation)</p>
            )}
          </section>

          <section className="hero" aria-label="Seat map">
            {sel ? (
              <>
                <div className="hero__head">
                  <h3 className="hero__title">
                    {formatTime(sel.startTime)} · {formatLabel(sel.format)}
                    <small>
                      {sel.cinemaName || sel.cinemaId}
                      {sel.screenName ? ` · Screen ${sel.screenName}` : ""}
                      {typeof sel.seatsAvailable === "number" ? ` · ${sel.seatsAvailable} seats free` : ""}
                    </small>
                  </h3>
                  <a
                    className="btn btn--primary hero__book"
                    href={sel.bookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Book on {chainLabel(sel.chain)} ↗
                  </a>
                </div>
                {seatLoading && <p className="hero__msg hint">Loading seat map…</p>}
                {seatError && <p className="hero__msg hint hint--warn">Seat map failed: {seatError}</p>}
                {seatMap && !seatLoading && <SeatMapView map={seatMap} topN={lastTopN} />}
              </>
            ) : (
              <div className="empty">Pick a session to see its seat map.</div>
            )}
          </section>
        </div>
      )}

      {sel && (
        <div className="stickybook stickybook--on">
          <span className="lbl">
            Best seat <b>{selectedRanked?.bestScore}</b> · {formatTime(sel.startTime)}
          </span>
          <a className="btn btn--primary" href={sel.bookingUrl} target="_blank" rel="noopener noreferrer">
            Book ↗
          </a>
        </div>
      )}
        </>
      )}
    </div>
  );
}
