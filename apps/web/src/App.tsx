import { useMemo, useState } from "react";
import { QueryForm, DEFAULTS, type FormValues } from "./components/QueryForm";
import { SessionCard } from "./components/SessionCard";
import { SeatMapView } from "./components/SeatMapView";
import { TogetherView } from "./components/TogetherView";
import { fetchBest, fetchSeatMap, type ScoringParams, API_BASE } from "./api";
import type { BestResponse, ScoredSeatMap, Session } from "./types";
import { chainLabel, formatLabel, formatTime, withinWindow } from "./format";

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
  const [mode, setMode] = useState<Mode>("best");
  const [values, setValues] = useState<FormValues>(DEFAULTS);
  const [result, setResult] = useState<BestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refineOpen, setRefineOpen] = useState(true);
  const [summary, setSummary] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seatMap, setSeatMap] = useState<ScoredSeatMap | null>(null);
  const [seatLoading, setSeatLoading] = useState(false);
  const [seatError, setSeatError] = useState<string | null>(null);

  // Snapshot of the scoring used for the last search - seat maps reuse it.
  const [lastScoring, setLastScoring] = useState<ScoringParams>(scoringOf(DEFAULTS));
  const [lastTopN, setLastTopN] = useState(DEFAULTS.topN);

  const visibleSessions = useMemo(() => {
    if (!result) return [];
    return result.sessions.filter((r) => withinWindow(r.session, values.from, values.to));
  }, [result, values.from, values.to]);

  const selectedRanked = useMemo(
    () => visibleSessions.find((r) => r.session.id === selectedId) ?? null,
    [visibleSessions, selectedId],
  );

  // Load (or switch to) a session's seat map. Hero model: always select, never toggle closed.
  const openSession = async (session: Session, scoring: ScoringParams) => {
    if (selectedId === session.id) return;
    setSelectedId(session.id);
    setSeatMap(null);
    setSeatError(null);
    setSeatLoading(true);
    try {
      const map = await fetchSeatMap(session.chain, session.id, scoring);
      setSeatMap(map);
    } catch (err) {
      setSeatError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeatLoading(false);
    }
  };

  const runSearch = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setSelectedId(null);
    setSeatMap(null);
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
      setResult(res);
      setRefineOpen(false);
      // Auto-select the top-ranked visible session so the hero is never empty.
      const first = res.sessions.find((r) => withinWindow(r.session, values.from, values.to));
      if (first) void openSession(first.session, scoring);
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
            aria-selected={mode === "best"}
            className={`btn btn--ghost${mode === "best" ? " btn--on" : ""}`}
            onClick={() => setMode("best")}
          >
            Best seat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "together"}
            className={`btn btn--ghost${mode === "together" ? " btn--on" : ""}`}
            onClick={() => setMode("together")}
          >
            Seats together
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
              <p className="hint">No sessions match the time window.</p>
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
