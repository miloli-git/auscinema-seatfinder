import { useMemo, useState } from "react";
import { Matrix } from "./Matrix";
import { TogetherDrillIn } from "./TogetherDrillIn";
import { MinScoreControl } from "./MinScoreControl";
import { getTogether, API_BASE } from "../api";
import { buildMatrix, type TogetherResult } from "../together/matrix";
import { normalizeTogetherSession } from "../together/normalize";
import { matchesFormat, matchesTime, type TimePreset } from "../together/filters";
import type { Chain, ScreenFormat } from "../types";

const CHAINS: { value: Chain; label: string }[] = [
  { value: "event", label: "Event Cinemas" },
  { value: "hoyts", label: "Hoyts" },
  { value: "reading", label: "Reading" },
  { value: "village", label: "Village" },
];

const FORMAT_KINDS: { value: ScreenFormat["kind"]; label: string }[] = [
  { value: "imax", label: "IMAX" },
  { value: "vmax", label: "V-Max" },
  { value: "goldclass", label: "Gold Class" },
  { value: "standard", label: "Standard" },
  { value: "other", label: "Other" },
];

const TIME_PRESETS: { value: TimePreset; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "evenings", label: "Evenings" },
  { value: "weekends", label: "Weekends" },
];

const fileDate = (r: TogetherResult): string => r.session.startTime.slice(0, 10);

/**
 * Seats-Together mode. One /together call per (movie, party, minScore) is cached;
 * format/time/day are applied client-side via buildMatrix (L2). A minScore change
 * re-queries (L3.7). Clicking a score cell opens the live-confirm drill-in.
 */
export function TogetherView() {
  const [chain, setChain] = useState<Chain>("event");
  const [movieId, setMovieId] = useState("");
  const [party, setParty] = useState(2);
  const [minScore, setMinScore] = useState(74);

  const [formats, setFormats] = useState<ScreenFormat["kind"][]>([]);
  const [timePreset, setTimePreset] = useState<TimePreset>("any");

  const [results, setResults] = useState<TogetherResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ cinemaId: string; cinemaName: string; date: string } | null>(null);

  // One /together fetch per (movie, party, minScore). format/time/day stay client-side.
  const query = async (override?: { minScore?: number }) => {
    if (!movieId.trim()) {
      setError("Enter a movie id to scan.");
      return;
    }
    const ms = override?.minScore ?? minScore;
    setLoading(true);
    setError(null);
    setDrill(null);
    try {
      const res = await getTogether({ chain, movieId: movieId.trim(), party, minScore: ms });
      setResults(res.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  const onMinScoreChange = (n: number) => {
    setMinScore(n);
    if (results) void query({ minScore: n }); // re-query, not a client re-filter (L3.7)
  };

  const model = useMemo(
    () => buildMatrix(results ?? [], { formats, timePreset, minScore }),
    [results, formats, timePreset, minScore],
  );

  // Qualifying (blocked) sessions for the drilled cell, under the current filters.
  const drillResults = useMemo<TogetherResult[]>(() => {
    if (!drill || !results) return [];
    return results.filter((r) => {
      if (r.session.cinemaId !== drill.cinemaId) return false;
      if (fileDate(r) !== drill.date) return false;
      if (!r.block) return false;
      const session = normalizeTogetherSession(r.session);
      return matchesFormat(session, formats) && matchesTime(session, timePreset);
    });
  }, [drill, results, formats, timePreset]);

  const toggleFormat = (k: ScreenFormat["kind"]) =>
    setFormats((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]));

  return (
    <div className="together">
      <div className="together__controls">
        <label className="field">
          <span>Chain</span>
          <select value={chain} onChange={(e) => setChain(e.target.value as Chain)}>
            {CHAINS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Movie id</span>
          <input value={movieId} onChange={(e) => setMovieId(e.target.value)} placeholder="e.g. 19796" />
        </label>
        <label className="field">
          <span>Party</span>
          <input
            type="number"
            min={2}
            max={10}
            value={party}
            onChange={(e) => setParty(Math.max(2, Number(e.target.value) || 2))}
          />
        </label>
        <MinScoreControl value={minScore} onMinScoreChange={onMinScoreChange} />
        <button type="button" className="btn btn--primary" onClick={() => void query()} disabled={loading}>
          {loading ? "Scanning…" : "Scan"}
        </button>
      </div>

      <div className="together__filters">
        <div className="chips">
          {FORMAT_KINDS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`chip${formats.includes(f.value) ? " chip--on" : ""}`}
              onClick={() => toggleFormat(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select value={timePreset} onChange={(e) => setTimePreset(e.target.value as TimePreset)}>
          {TIME_PRESETS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="banner banner--error" role="alert">
          <strong>Scan failed.</strong> {error}
        </div>
      )}
      {loading && <div className="empty">Scanning sessions…</div>}

      {!loading && results && model.cinemas.length === 0 && (
        <div className="empty">No sessions match. Try a lower min score or another movie.</div>
      )}

      {!loading && results && model.cinemas.length > 0 && (
        <Matrix
          model={model}
          onCellClick={(cinemaId, date) => {
            const name = model.cinemas.find((c) => c.id === cinemaId)?.name ?? cinemaId;
            setDrill({ cinemaId, cinemaName: name, date });
          }}
        />
      )}

      {drill && drillResults.length > 0 && (
        <TogetherDrillIn
          cinemaName={drill.cinemaName}
          date={drill.date}
          results={drillResults}
          onClose={() => setDrill(null)}
        />
      )}

      {!results && !loading && !error && (
        <div className="empty">
          <p>
            <strong>Find seats together.</strong>
          </p>
          <p className="hint">
            Pick a chain and movie, set party size and min score, then scan across cinemas and dates.
          </p>
          <p className="api-base">API · {API_BASE || "same-origin (proxy)"}</p>
        </div>
      )}
    </div>
  );
}
