import { useEffect, useMemo, useState } from "react";
import type { AreaKind, Cinema, Movie } from "../types";
import { SELECTABLE_AREA_KINDS } from "../types";
import { fetchCinemas, fetchMovies } from "../api";

export interface FormValues {
  chain: string;
  movieId: string;
  cinemaIds: string;
  date: string;
  from: string;
  to: string;
  topN: number;
  targetDepth: number;
  depthWeight: number;
  centralityWeight: number;
  allowedAreaKinds: AreaKind[];
  avoidPaired: boolean;
}

export const DEFAULTS: FormValues = {
  chain: "event",
  movieId: "",
  cinemaIds: "",
  date: "",
  from: "",
  to: "",
  topN: 5,
  targetDepth: 0.65,
  depthWeight: 0.5,
  centralityWeight: 0.5,
  allowedAreaKinds: [],
  avoidPaired: false,
};

const CHAINS: { value: string; label: string }[] = [
  { value: "event", label: "Event Cinemas" },
  { value: "hoyts", label: "Hoyts" },
  { value: "reading", label: "Reading Cinemas" },
  { value: "village", label: "Village Cinemas" },
];

const AREA_LABEL: Record<AreaKind, string> = {
  standard: "Standard",
  recliner: "Recliner",
  premium: "Premium",
  goldclass: "Gold Class",
  daybed: "Daybed",
  companion: "Companion",
  other: "Other",
};

/** Parse the comma-separated cinemaIds string into a clean id list. */
function idList(cinemaIds: string): string[] {
  return cinemaIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

interface Props {
  values: FormValues;
  onChange: (v: FormValues) => void;
  onSubmit: () => void;
  loading: boolean;
}

export function QueryForm({ values, onChange, onSubmit, loading }: Props) {
  const [cinemas, setCinemas] = useState<Cinema[]>([]);
  const [cinemaError, setCinemaError] = useState<string | null>(null);
  const [cinemaFilter, setCinemaFilter] = useState("");

  const [movies, setMovies] = useState<Movie[]>([]);
  const [moviesLoading, setMoviesLoading] = useState(false);
  const [movieError, setMovieError] = useState<string | null>(null);

  const set = <K extends keyof FormValues>(key: K, val: FormValues[K]) =>
    onChange({ ...values, [key]: val });

  const selectedIds = useMemo(() => idList(values.cinemaIds), [values.cinemaIds]);

  // Refetch cinemas whenever the chain changes.
  useEffect(() => {
    let live = true;
    setCinemas([]);
    fetchCinemas(values.chain)
      .then((list) => {
        if (live) {
          setCinemas(list);
          setCinemaError(null);
        }
      })
      .catch((err: unknown) => {
        if (live) setCinemaError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, [values.chain]);

  // Fetch the movie list once chain + at least one cinema + date are chosen.
  useEffect(() => {
    if (!values.chain || selectedIds.length === 0 || !values.date) {
      setMovies([]);
      setMovieError(null);
      setMoviesLoading(false);
      return;
    }
    let live = true;
    setMoviesLoading(true);
    setMovieError(null);
    fetchMovies(values.chain, selectedIds.join(","), values.date)
      .then((list) => {
        if (!live) return;
        setMovies(list);
        setMoviesLoading(false);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setMovies([]);
        setMovieError(err instanceof Error ? err.message : String(err));
        setMoviesLoading(false);
      });
    return () => {
      live = false;
    };
  }, [values.chain, values.cinemaIds, values.date, selectedIds.length]);

  // Drop the selected movie if it falls out of the available list (e.g. cinema/date change).
  useEffect(() => {
    if (values.movieId && movies.length > 0 && !movies.some((m) => m.id === values.movieId)) {
      set("movieId", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movies]);

  const switchChain = (chain: string) => {
    // Changing chain invalidates cinema + movie selections.
    onChange({ ...values, chain, cinemaIds: "", movieId: "" });
    setCinemaFilter("");
    setMovies([]);
  };

  const toggleCinema = (id: string) => {
    const ids = selectedIds.includes(id)
      ? selectedIds.filter((c) => c !== id)
      : [...selectedIds, id];
    // Clearing or changing cinemas invalidates the movie pick.
    onChange({ ...values, cinemaIds: ids.join(", "), movieId: "" });
  };

  const toggleArea = (kind: AreaKind) => {
    const next = values.allowedAreaKinds.includes(kind)
      ? values.allowedAreaKinds.filter((k) => k !== kind)
      : [...values.allowedAreaKinds, kind];
    set("allowedAreaKinds", next);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  const filteredCinemas = useMemo(() => {
    const q = cinemaFilter.trim().toLowerCase();
    if (!q) return cinemas;
    return cinemas.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.region ? c.region.toLowerCase().includes(q) : false),
    );
  }, [cinemas, cinemaFilter]);

  const cinemaName = (id: string): string => {
    const c = cinemas.find((x) => x.id === id);
    return c ? c.name : id;
  };

  const ready =
    Boolean(values.chain) &&
    selectedIds.length > 0 &&
    Boolean(values.date) &&
    Boolean(values.movieId);

  return (
    <form className="form" onSubmit={submit}>
      <h2 className="form__title">Find a seat</h2>

      <label className="field">
        <span>Chain</span>
        <select value={values.chain} onChange={(e) => switchChain(e.target.value)}>
          {CHAINS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="field cinemas">
        <legend>Cinemas</legend>
        {selectedIds.length > 0 && (
          <div className="chips">
            {selectedIds.map((id) => (
              <button
                type="button"
                key={id}
                className="chip chip--on"
                onClick={() => toggleCinema(id)}
                title="Remove"
              >
                {cinemaName(id)} ✕
              </button>
            ))}
          </div>
        )}
        {cinemaError && (
          <p className="hint hint--warn">Cinema list unavailable: {cinemaError}</p>
        )}
        {!cinemaError && cinemas.length === 0 && (
          <p className="hint">Loading cinemas…</p>
        )}
        {cinemas.length > 0 && (
          <>
            <input
              type="text"
              className="cinemas__filter"
              placeholder="Filter cinemas by name…"
              value={cinemaFilter}
              onChange={(e) => setCinemaFilter(e.target.value)}
            />
            <div className="checklist">
              {filteredCinemas.map((c) => (
                <label key={c.id} className="checklist__item">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(c.id)}
                    onChange={() => toggleCinema(c.id)}
                  />
                  <span>
                    {c.name}
                    {c.region ? ` (${c.region})` : ""}
                  </span>
                </label>
              ))}
              {filteredCinemas.length === 0 && (
                <p className="hint">No cinemas match that filter.</p>
              )}
            </div>
          </>
        )}
      </fieldset>

      <label className="field">
        <span>Date</span>
        <input type="date" value={values.date} onChange={(e) => set("date", e.target.value)} />
      </label>

      <label className="field">
        <span>Movie</span>
        <select
          value={values.movieId}
          onChange={(e) => set("movieId", e.target.value)}
          disabled={selectedIds.length === 0 || !values.date || moviesLoading}
        >
          <option value="">
            {selectedIds.length === 0 || !values.date
              ? "Pick cinemas and a date first"
              : moviesLoading
                ? "Loading movies…"
                : movies.length === 0
                  ? "No movies playing - try another date/cinema"
                  : "Pick a movie…"}
          </option>
          {movies.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {movieError && <p className="hint hint--warn">Movie list failed: {movieError}</p>}

      <div className="field field--row">
        <label className="field">
          <span>From</span>
          <input type="time" value={values.from} onChange={(e) => set("from", e.target.value)} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="time" value={values.to} onChange={(e) => set("to", e.target.value)} />
        </label>
      </div>

      <hr className="form__rule" />
      <h3 className="form__subtitle">Seat preferences</h3>

      <label className="field">
        <span>
          Target depth <em>{values.targetDepth.toFixed(2)}</em>
          <small> (front to back)</small>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={values.targetDepth}
          onChange={(e) => set("targetDepth", Number(e.target.value))}
        />
      </label>

      <label className="field">
        <span>
          Centrality vs depth <em>{Math.round(values.centralityWeight * 100)}% central</em>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={values.centralityWeight}
          onChange={(e) => {
            const c = Number(e.target.value);
            onChange({ ...values, centralityWeight: c, depthWeight: Number((1 - c).toFixed(2)) });
          }}
        />
        <small className="hint">
          depth {Math.round(values.depthWeight * 100)}% · central{" "}
          {Math.round(values.centralityWeight * 100)}%
        </small>
      </label>

      <fieldset className="field areas">
        <legend>Seat classes</legend>
        <div className="chips">
          {SELECTABLE_AREA_KINDS.map((kind) => (
            <button
              type="button"
              key={kind}
              className={`chip${values.allowedAreaKinds.includes(kind) ? " chip--on" : ""}`}
              onClick={() => toggleArea(kind)}
            >
              {AREA_LABEL[kind]}
            </button>
          ))}
        </div>
        <small className="hint">None selected = all classes allowed.</small>
      </fieldset>

      <label className="field field--check">
        <input
          type="checkbox"
          checked={values.avoidPaired}
          onChange={(e) => set("avoidPaired", e.target.checked)}
        />
        <span>Avoid paired / couple seats</span>
      </label>

      <label className="field">
        <span>Top seats per session</span>
        <input
          type="number"
          min={1}
          max={20}
          value={values.topN}
          onChange={(e) => set("topN", Math.max(1, Number(e.target.value) || 1))}
        />
      </label>

      <button type="submit" className="btn btn--primary" disabled={loading || !ready}>
        {loading ? "Searching…" : "Find best seats"}
      </button>
    </form>
  );
}
