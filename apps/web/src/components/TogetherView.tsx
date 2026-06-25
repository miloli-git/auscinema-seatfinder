import { useEffect, useMemo, useRef, useState } from "react";
import { Matrix } from "./Matrix";
import { TogetherDrillIn } from "./TogetherDrillIn";
import { MinScoreControl } from "./MinScoreControl";
import { getTogether, fetchCatalog, API_BASE, type CatalogMovie } from "../api";
import { buildMatrix, type TogetherResult } from "../together/matrix";
import { normalizeTogetherSession } from "../together/normalize";
import { matchesFormat, matchesTime, type TimePreset } from "../together/filters";
import { isUpcoming, sydneyNow } from "../format";
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

// Keep a session visible until this long after its showtime — a show that just started is often still
// bookable (trailers), and the live drill-in confirm is the real bookability check anyway.
const SHOWTIME_GRACE_MS = 20 * 60_000;

type CatalogState =
  | { status: "loading"; chain: Chain }
  | { status: "ready"; chain: Chain; movies: CatalogMovie[] }
  | { status: "error"; chain: Chain; error: string };

/**
 * Map catalog movies to <select> option models. Label = trimmed name || id;
 * when two visible labels collide, both are disambiguated with their id.
 */
function buildMovieOptions(movies: CatalogMovie[]): { id: string; label: string }[] {
  // Bare label = trimmed name || id. Names that collide get their (unique) id appended. A `used`
  // set then guarantees globally-unique visible labels even for titles that resemble a generated
  // disambiguation (e.g. a real "Foo (1)" title alongside other "Foo" rows): the clashing one
  // gets a numeric suffix. ids are unique, so this always terminates with distinct labels.
  const nameCounts = new Map<string, number>();
  for (const m of movies) {
    const name = m.name?.trim() || m.id;
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  const used = new Set<string>();
  return movies.map((m) => {
    const name = m.name?.trim() || m.id;
    let label = (nameCounts.get(name) ?? 0) > 1 ? `${name} (${m.id})` : name;
    if (used.has(label)) {
      let n = 2;
      while (used.has(`${label} [${n}]`)) n++;
      label = `${label} [${n}]`;
    }
    used.add(label);
    return { id: m.id, label };
  });
}

/**
 * Seats-Together mode. One /together call per (movie, party, minScore) is cached;
 * format/time/day are applied client-side via buildMatrix (L2). A minScore change
 * re-queries (L3.7). Clicking a score cell opens the live-confirm drill-in.
 */
export function TogetherView() {
  const [chain, setChain] = useState<Chain>("event");
  const [movieId, setMovieId] = useState("");
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading", chain: "event" });
  const [party, setParty] = useState(2);
  const [minScore, setMinScore] = useState(74);

  const [formats, setFormats] = useState<ScreenFormat["kind"][]>([]);
  const [timePreset, setTimePreset] = useState<TimePreset>("any");

  const [results, setResults] = useState<TogetherResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ cinemaId: string; cinemaName: string; date: string } | null>(null);
  // Snapshot of the params that produced `results`. minScore re-queries fire against THIS,
  // not the live (possibly edited) chain/movie/party inputs, which are Scan-only.
  const [scanned, setScanned] = useState<{ chain: Chain; movieId: string; party: number } | null>(null);
  // Monotonic request id: only the latest in-flight /together response is applied (no out-of-order clobber).
  const reqSeq = useRef(0);
  // Sydney "now" ticking each minute, so sessions age out of the grid live — not only on a re-scan.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Fetch the movie catalog on mount and on every chain change. The `live` flag drops a stale
  // response from a previous chain, and the state we set is keyed to the chain it was fetched for,
  // so a slow prior-chain /catalog can never overwrite the current chain's catalog (D6).
  useEffect(() => {
    let live = true;
    const forChain = chain;
    setCatalog({ status: "loading", chain: forChain });
    fetchCatalog(forChain)
      .then((res) => {
        if (live) setCatalog({ status: "ready", chain: forChain, movies: res.movies });
      })
      .catch((err: unknown) => {
        if (live) {
          setCatalog({ status: "error", chain: forChain, error: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      live = false;
    };
  }, [chain]);

  // One /together fetch per (chain, movie, party, minScore). format/time/day stay client-side.
  const runQuery = async (p: { chain: Chain; movieId: string; party: number; minScore: number }) => {
    if (!p.movieId.trim()) {
      setError("Enter a movie id to scan.");
      setResults(null);
      setScanned(null);
      setDrill(null);
      return;
    }
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    setDrill(null);
    try {
      const res = await getTogether({ chain: p.chain, movieId: p.movieId.trim(), party: p.party, minScore: p.minScore });
      if (seq !== reqSeq.current) return; // a newer request superseded this one
      setResults(res.results);
      setScanned({ chain: p.chain, movieId: p.movieId.trim(), party: p.party });
    } catch (err) {
      if (seq !== reqSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setResults(null);
      setScanned(null);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  };

  const scan = () => void runQuery({ chain, movieId, party, minScore });

  // Chain switch = full reset boundary (D4/D5, non-negotiable). Bump reqSeq so any in-flight
  // /together for the old chain is dropped, then clear everything tied to the old chain. The
  // catalog effect refetches for the new chain.
  const switchChain = (next: Chain) => {
    if (next === chain) return;
    reqSeq.current++;
    setChain(next);
    // Synchronously reset the catalog to loading for the NEW chain so the render between this
    // commit and the catalog effect can never paint the old chain's movies (Codex HIGH).
    setCatalog({ status: "loading", chain: next });
    setMovieId("");
    setScanned(null);
    setResults(null);
    setDrill(null);
    setError(null);
    setLoading(false);
  };

  // Only trust the catalog when it was fetched for the chain currently selected. Belt-and-braces
  // with the synchronous reset above: any chain/catalog mismatch renders as loading, never stale.
  const catalogReady = catalog.status === "ready" && catalog.chain === chain;
  const catalogError = catalog.status === "error" && catalog.chain === chain;

  const movieOptions = useMemo(
    () => (catalogReady ? buildMovieOptions((catalog as Extract<CatalogState, { status: "ready" }>).movies) : []),
    [catalogReady, catalog],
  );

  const onMinScoreChange = (n: number) => {
    setMinScore(n);
    if (scanned) void runQuery({ ...scanned, minScore: n }); // re-query against the scanned snapshot (L3.7)
  };

  // Drop sessions whose local showtime has passed in Sydney, minus a short grace (#43). ONE `now`
  // snapshot per pass (not per row — avoids a minute-boundary split). Filtered here so the matrix AND
  // the drill-in (both derive from these results) stay consistent — no past shows offering cached
  // scores for screenings that are over.
  const upcoming = useMemo(() => {
    const cutoff = sydneyNow(new Date(nowMs - SHOWTIME_GRACE_MS));
    return (results ?? []).filter((r) => isUpcoming(r.session.startTime, cutoff));
  }, [results, nowMs]);

  const model = useMemo(
    () => buildMatrix(upcoming, { formats, timePreset, minScore }),
    [upcoming, formats, timePreset, minScore],
  );

  // Qualifying (blocked) sessions for the drilled cell, under the current filters.
  const drillResults = useMemo<TogetherResult[]>(() => {
    if (!drill) return [];
    return upcoming.filter((r) => {
      if (r.session.cinemaId !== drill.cinemaId) return false;
      if (fileDate(r) !== drill.date) return false;
      if (!r.block) return false;
      const session = normalizeTogetherSession(r.session);
      return matchesFormat(session, formats) && matchesTime(session, timePreset);
    });
  }, [drill, upcoming, formats, timePreset]);

  const toggleFormat = (k: ScreenFormat["kind"]) =>
    setFormats((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]));

  return (
    <div className="together">
      <div className="together__controls">
        <label className="field">
          <span>Chain</span>
          <select value={chain} onChange={(e) => switchChain(e.target.value as Chain)}>
            {CHAINS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {catalogError ? (
          <label className="field">
            <span>Movie id</span>
            <input value={movieId} onChange={(e) => setMovieId(e.target.value)} placeholder="e.g. 19796" />
            <small className="hint hint--warn">Movie list unavailable — enter a movie id directly.</small>
          </label>
        ) : (
          <label className="field">
            <span>Movie</span>
            <select value={movieId} onChange={(e) => setMovieId(e.target.value)} disabled={!catalogReady}>
              <option value="">
                {!catalogReady
                  ? "Loading movies…"
                  : movieOptions.length === 0
                    ? "No movies cached for this chain yet"
                    : "Pick a movie…"}
              </option>
              {movieOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
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
        <button type="button" className="btn btn--primary" onClick={scan} disabled={loading}>
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
        <div className="empty">
          {results.length > 0 && upcoming.length === 0
            ? "All matching sessions have already started. Try another movie or check back for later sessions."
            : "No sessions match. Try a lower min score or another movie."}
        </div>
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
          party={scanned?.party ?? party}
          minScore={minScore}
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
