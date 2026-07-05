import { useEffect, useRef, useState } from "react";
import { DEFAULT_SCORING, fetchSeatMap as apiFetchSeatMap, type ScoringParams } from "../api";
import { SeatMapView } from "../components/SeatMapView";
import { chainLabel, formatShortDate, formatTime } from "../format";
import type { ScoredSeatMap } from "../types";
import { fetchAvailability as apiFetchAvailability, type AvailabilityQuery } from "./api";
import { fetchGroupAvailability } from "./availabilityGroup";
import { DateAvailabilityStrip } from "./DateAvailabilityStrip";
import { displayCinemaName } from "./present";
import type { AvailabilityResponse, Option } from "./types";

// Stable reference so solo-mode renders never retrigger the /availability effect merely because
// the caller's real dayCounts Map reference changed in the background — same rationale as
// AvailabilitySummary's own EMPTY_DAY_COUNTS.
const EMPTY_DAY_COUNTS: ReadonlyMap<string, number> = new Map();

type SeatMapFetcher = (
  chain: string,
  sessionId: string,
  scoring: ScoringParams,
  options?: { party?: number; minScore?: number },
) => Promise<ScoredSeatMap>;

interface Props {
  option: Option;
  movieKey: string;
  /** Party used for the /seatmap fetch (unaffected by this fix) and as the /availability fallback
   *  party when there's nothing to fan out over — see `groupMode`/`dayCounts` below. */
  party: number;
  /** True in Plan-group mode — when set along with a `dayCounts` with >1 distinct headcount, the
   *  strip's /availability fetch fans out per headcount instead of using the single `party` above
   *  for every day (47c-followup: same false-claim class PR #80 fixed for option cards). */
  groupMode?: boolean;
  dayCounts?: ReadonlyMap<string, number>;
  minScore: number;
  onClose: () => void;
  /** 47c fix #5: forwarded to the DateAvailabilityStrip so a cell click applies that date as the
   *  option list's day filter (fix #2) — omit to leave the strip's cells non-interactive. */
  onSelectDate?: (date: string) => void;
  /** Injectable for tests; defaults to the live /seatmap call. */
  fetchSeatMap?: SeatMapFetcher;
  /** Injectable for tests; defaults to the live /availability call. */
  fetchAvailability?: (q: AvailabilityQuery) => Promise<AvailabilityResponse>;
  scoring?: ScoringParams;
  topN?: number;
}

type State =
  | { status: "loading" }
  | { status: "ok"; map: ScoredSeatMap }
  | { status: "error"; message: string };

type AvailabilityState =
  | { status: "loading" }
  | { status: "ready"; data: AvailabilityResponse }
  | { status: "error" };

/**
 * Tap-through target for an option card: reuses the EXISTING seat-map hero view (SeatMapView) and
 * the existing "Book on <chain>" CTA pattern — wiring only, no rebuild. Mirrors
 * components/TogetherDrillIn.tsx's fetch/confirm shape, simplified to a single already-picked
 * session (no in-panel list to pick from).
 */
export function OptionSeatMapPanel({
  option,
  movieKey,
  party,
  groupMode = false,
  dayCounts = EMPTY_DAY_COUNTS,
  minScore,
  onClose,
  onSelectDate,
  fetchSeatMap = apiFetchSeatMap,
  fetchAvailability = apiFetchAvailability,
  scoring = DEFAULT_SCORING,
  topN = 5,
}: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [availability, setAvailability] = useState<AvailabilityState>({ status: "loading" });
  const reqRef = useRef(0);
  const availReqRef = useRef(0);

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

  useEffect(() => {
    let live = true;
    const token = ++availReqRef.current;
    setAvailability({ status: "loading" });
    // Narrowed to this option's own cinema (contract §1.1's `cinemaId` filter) so the strip reads
    // as "the date picture for the cinema you're already looking at," not the whole movie/chain.
    // 47c-followup: group mode with varying per-day headcounts fans out per distinct headcount and
    // merges honestly (see availabilityGroup.ts) instead of stamping every day with `party`, the
    // global max — same fix class as AvailabilitySummary's header line.
    fetchGroupAvailability(
      { movieKey, minScore, cinemaId: option.cinemaId },
      groupMode ? dayCounts : EMPTY_DAY_COUNTS,
      party,
      fetchAvailability,
    )
      .then(({ data }) => {
        if (live && availReqRef.current === token) setAvailability({ status: "ready", data });
      })
      .catch(() => {
        if (live && availReqRef.current === token) setAvailability({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [movieKey, option.cinemaId, party, groupMode, dayCounts, minScore, fetchAvailability]);

  return (
    <section className="hero optionseatmap" aria-label="Seat map">
      <div className="hero__head">
        <h3 className="hero__title">
          {/* 47c fix #4: the booking handoff must show the full selected session identity — the
             heading used to omit the date entirely, so the CTA was reached without on-screen
             confirmation of which calendar date was being booked. */}
          {displayCinemaName(option)} · {formatShortDate(option.date)} · {formatTime(option.startsAt)}
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
      {availability.status === "ready" && (
        <DateAvailabilityStrip availability={availability.data} onSelectDate={onSelectDate} />
      )}
    </section>
  );
}
