import { useEffect, useState } from "react";
import type { AreaKind, Cinema } from "../types";
import { SELECTABLE_AREA_KINDS } from "../types";
import { fetchCinemas } from "../api";

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

const AREA_LABEL: Record<AreaKind, string> = {
  standard: "Standard",
  recliner: "Recliner",
  premium: "Premium",
  goldclass: "Gold Class",
  daybed: "Daybed",
  companion: "Companion",
  other: "Other",
};

interface Props {
  values: FormValues;
  onChange: (v: FormValues) => void;
  onSubmit: () => void;
  loading: boolean;
}

export function QueryForm({ values, onChange, onSubmit, loading }: Props) {
  const [cinemas, setCinemas] = useState<Cinema[]>([]);
  const [cinemaError, setCinemaError] = useState<string | null>(null);

  const set = <K extends keyof FormValues>(key: K, val: FormValues[K]) =>
    onChange({ ...values, [key]: val });

  useEffect(() => {
    let live = true;
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

  const toggleArea = (kind: AreaKind) => {
    const next = values.allowedAreaKinds.includes(kind)
      ? values.allowedAreaKinds.filter((k) => k !== kind)
      : [...values.allowedAreaKinds, kind];
    set("allowedAreaKinds", next);
  };

  const addCinema = (id: string) => {
    if (!id) return;
    const ids = values.cinemaIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.includes(id)) set("cinemaIds", [...ids, id].join(", "));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  const ready = values.movieId.trim() && values.cinemaIds.trim() && values.date.trim();

  return (
    <form className="form" onSubmit={submit}>
      <h2 className="form__title">Find a seat</h2>

      <label className="field">
        <span>Chain</span>
        <select value={values.chain} onChange={(e) => set("chain", e.target.value)}>
          <option value="event">Event Cinemas</option>
        </select>
      </label>

      <label className="field">
        <span>Movie ID</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="e.g. 19797"
          value={values.movieId}
          onChange={(e) => set("movieId", e.target.value)}
        />
      </label>

      <label className="field">
        <span>Cinema IDs</span>
        <input
          type="text"
          placeholder="comma-separated, e.g. 58, 65"
          value={values.cinemaIds}
          onChange={(e) => set("cinemaIds", e.target.value)}
        />
      </label>

      {cinemas.length > 0 && (
        <label className="field">
          <span>Add cinema</span>
          <select
            value=""
            onChange={(e) => {
              addCinema(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">Pick from list…</option>
            {cinemas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.region ? ` (${c.region})` : ""} — {c.id}
              </option>
            ))}
          </select>
        </label>
      )}
      {cinemaError && (
        <p className="hint hint--warn">Cinema list unavailable — enter IDs by hand.</p>
      )}

      <label className="field">
        <span>Date</span>
        <input type="date" value={values.date} onChange={(e) => set("date", e.target.value)} />
      </label>

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
          <small> (front → back)</small>
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
