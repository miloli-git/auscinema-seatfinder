import { useMemo, useState } from "react";
import { QueryForm, DEFAULTS, type FormValues } from "./components/QueryForm";
import { SessionCard } from "./components/SessionCard";
import { SeatMapView } from "./components/SeatMapView";
import { fetchBest, fetchSeatMap, type ScoringParams, API_BASE } from "./api";
import type { BestResponse, ScoredSeatMap, Session } from "./types";
import { withinWindow } from "./format";

function scoringOf(v: FormValues): ScoringParams {
  return {
    targetDepth: v.targetDepth,
    depthWeight: v.depthWeight,
    centralityWeight: v.centralityWeight,
    allowedAreaKinds: v.allowedAreaKinds,
    avoidPaired: v.avoidPaired,
  };
}

export function App() {
  const [values, setValues] = useState<FormValues>(DEFAULTS);
  const [result, setResult] = useState<BestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const selectSession = async (session: Session) => {
    const sessionId = session.id;
    if (selectedId === sessionId) {
      setSelectedId(null);
      setSeatMap(null);
      return;
    }
    setSelectedId(sessionId);
    setSeatMap(null);
    setSeatError(null);
    setSeatLoading(true);
    try {
      const map = await fetchSeatMap(session.chain, session.id, lastScoring);
      setSeatMap(map);
    } catch (err) {
      setSeatError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeatLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <div className="brand">
          <span className="brand__mark">◐</span>
          <div>
            <h1 className="brand__title">AusCinema Seat Finder</h1>
            <p className="brand__tag">
              Rank sessions by the best seat in the house, then book on the chain.
            </p>
          </div>
        </div>
      </header>

      <main className="app__main">
        <aside className="app__sidebar">
          <QueryForm values={values} onChange={setValues} onSubmit={runSearch} loading={loading} />
          <p className="api-base">API · {API_BASE || "same-origin (proxy)"}</p>
        </aside>

        <section className="app__results">
          {error && (
            <div className="banner banner--error" role="alert">
              <strong>Search failed.</strong> {error}
            </div>
          )}

          {!result && !error && !loading && (
            <div className="empty">
              <p>Pick a chain, one or more cinemas, a date and a movie, then search.</p>
              <p className="hint">
                Start with Event Cinemas, choose a cinema near you, set today's date, then pick
                what's playing.
              </p>
            </div>
          )}

          {loading && <div className="empty">Searching sessions…</div>}

          {result && (
            <>
              <div className="results__head">
                <h2>
                  {visibleSessions.length} session{visibleSessions.length === 1 ? "" : "s"}
                </h2>
                {result.skipped.length > 0 && (
                  <span className="muted">{result.skipped.length} skipped (no seat allocation)</span>
                )}
              </div>

              {visibleSessions.length === 0 && (
                <p className="hint">No sessions match the time window.</p>
              )}

              <div className="results__list">
                {visibleSessions.map((r) => (
                  <div key={r.session.id}>
                    <SessionCard
                      ranked={r}
                      selected={selectedId === r.session.id}
                      onSelect={(session) => void selectSession(session)}
                    />
                    {selectedId === r.session.id && (
                      <div className="seatpanel">
                        {seatLoading && <p className="hint">Loading seat map…</p>}
                        {seatError && (
                          <p className="hint hint--warn">Seat map failed: {seatError}</p>
                        )}
                        {seatMap && <SeatMapView map={seatMap} topN={lastTopN} />}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
