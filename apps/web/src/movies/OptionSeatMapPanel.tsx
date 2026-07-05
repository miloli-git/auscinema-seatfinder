import { useEffect, useRef, useState } from "react";
import { DEFAULT_SCORING, fetchSeatMap as apiFetchSeatMap, type ScoringParams } from "../api";
import { SeatMapView } from "../components/SeatMapView";
import { chainLabel, formatTime } from "../format";
import type { ScoredSeatMap } from "../types";
import { displayCinemaName } from "./present";
import type { Option } from "./types";

type SeatMapFetcher = (
  chain: string,
  sessionId: string,
  scoring: ScoringParams,
  options?: { party?: number; minScore?: number },
) => Promise<ScoredSeatMap>;

interface Props {
  option: Option;
  party: number;
  minScore: number;
  onClose: () => void;
  /** Injectable for tests; defaults to the live /seatmap call. */
  fetchSeatMap?: SeatMapFetcher;
  scoring?: ScoringParams;
  topN?: number;
}

type State =
  | { status: "loading" }
  | { status: "ok"; map: ScoredSeatMap }
  | { status: "error"; message: string };

/**
 * Tap-through target for an option card: reuses the EXISTING seat-map hero view (SeatMapView) and
 * the existing "Book on <chain>" CTA pattern — wiring only, no rebuild. Mirrors
 * components/TogetherDrillIn.tsx's fetch/confirm shape, simplified to a single already-picked
 * session (no in-panel list to pick from).
 */
export function OptionSeatMapPanel({
  option,
  party,
  minScore,
  onClose,
  fetchSeatMap = apiFetchSeatMap,
  scoring = DEFAULT_SCORING,
  topN = 5,
}: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const reqRef = useRef(0);

  useEffect(() => {
    let live = true;
    const token = ++reqRef.current;
    setState({ status: "loading" });
    fetchSeatMap(option.chain, option.sessionId, scoring, { party, minScore })
      .then((map) => {
        if (live && reqRef.current === token) setState({ status: "ok", map });
      })
      .catch((err: unknown) => {
        if (live && reqRef.current === token) {
          setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      live = false;
    };
  }, [option.chain, option.sessionId, party, minScore, fetchSeatMap, scoring]);

  return (
    <section className="hero optionseatmap" aria-label="Seat map">
      <div className="hero__head">
        <h3 className="hero__title">
          {displayCinemaName(option)} · {formatTime(option.startsAt)}
          <small>{chainLabel(option.chain)}</small>
        </h3>
        <div className="optionseatmap__actions">
          <a
            className="btn btn--primary hero__book"
            href={option.bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Book on {chainLabel(option.chain)} ↗
          </a>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {state.status === "loading" && <p className="hero__msg hint">Loading seat map…</p>}
      {state.status === "error" && (
        <p className="hero__msg hint hint--warn">Seat map failed: {state.message}</p>
      )}
      {state.status === "ok" && (
        <SeatMapView map={state.map} topN={topN} highlightSeatIds={state.map.block?.seatIds} />
      )}
    </section>
  );
}
