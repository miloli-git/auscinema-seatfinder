import { useState } from "react";
import type { TogetherResult } from "../together/matrix";
import { normalizeTogetherSession } from "../together/normalize";
import type { ScoredSeatMap } from "../types";
import { DEFAULT_SCORING, fetchSeatMap as apiFetchSeatMap, type ScoringParams } from "../api";
import { SeatMapView } from "./SeatMapView";
import { chainLabel, formatLabel, formatTime } from "../format";

type SeatMapFetcher = (
  chain: string,
  sessionId: string,
  scoring: ScoringParams,
) => Promise<ScoredSeatMap>;

interface Props {
  cinemaName: string;
  /** YYYY-MM-DD of the clicked cell. */
  date: string;
  /** The cell's qualifying (blocked) sessions, best-first is fine. */
  results: TogetherResult[];
  onClose?: () => void;
  /** Injectable for tests; defaults to the live /seatmap call. */
  fetchSeatMap?: SeatMapFetcher;
  /** Scoring for the confirm; defaults to the app's default profile (#37). */
  scoring?: ScoringParams;
  topN?: number;
}

type Confirm =
  | { state: "loading"; result: TogetherResult }
  | { state: "ok"; result: TogetherResult; map: ScoredSeatMap }
  | { state: "gone"; result: TogetherResult }
  | { state: "error"; result: TogetherResult; message: string };

/** Available seat ids in a live map (a sold/missing block seat = block gone). */
function availableIds(map: ScoredSeatMap): Set<string> {
  const s = new Set<string>();
  for (const seat of map.seats) if (seat.status === "available") s.add(seat.id);
  return s;
}

/**
 * Drill-in for a clicked matrix cell (L3.3). Lists the cell's qualifying
 * sessions; picking one fires a LIVE /seatmap confirm with the default scoring
 * profile (#37 / L3.5). If the block's seats are gone from the live map, shows a
 * "block gone" state (#38 / L3.6); otherwise highlights the block on the map.
 */
export function TogetherDrillIn({
  cinemaName,
  date,
  results,
  onClose,
  fetchSeatMap = apiFetchSeatMap,
  scoring = DEFAULT_SCORING,
  topN = 5,
}: Props) {
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const pick = async (result: TogetherResult) => {
    const block = result.block;
    if (!block) return;
    setConfirm({ state: "loading", result });
    try {
      const map = await fetchSeatMap(result.session.chain, result.session.id, scoring);
      const avail = availableIds(map);
      const gone = !block.seatIds.every((id) => avail.has(id));
      setConfirm(gone ? { state: "gone", result } : { state: "ok", result, map });
    } catch (err) {
      setConfirm({ state: "error", result, message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="drillin" role="dialog" aria-label={`Sessions at ${cinemaName} on ${date}`}>
      <div className="drillin__head">
        <h3 className="drillin__title">
          {cinemaName} <small>{date}</small>
        </h3>
        {onClose && (
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      <ul className="drillin__list">
        {results.map((r) => {
          const session = normalizeTogetherSession(r.session);
          const selected = confirm?.result.session.id === r.session.id;
          return (
            <li key={r.session.id}>
              <button
                type="button"
                className="drillin__row"
                data-session-row=""
                aria-pressed={selected}
                onClick={() => void pick(r)}
              >
                <span className="drillin__time">{formatTime(session.startTime)}</span>
                <span className="tag">{formatLabel(session.format)}</span>
                <span className="drillin__avg">{r.block?.avgScore}</span>
                {r.fetchedAt && (
                  <span className="drillin__asof">as of {formatTime(r.fetchedAt)}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {confirm && (
        <div className="drillin__confirm">
          {confirm.state === "loading" && <p className="hint">Confirming live seat map…</p>}
          {confirm.state === "error" && (
            <p className="hint hint--warn">Seat map failed: {confirm.message}</p>
          )}
          {confirm.state === "gone" && (
            <p className="hint hint--warn">
              Block gone — those seats are no longer available. Re-run the search or pick another
              session.
            </p>
          )}
          {confirm.state === "ok" && (
            <>
              <div className="drillin__confirm-head">
                <span>
                  Adjacent block highlighted ·{" "}
                  <a
                    href={confirm.result.session.bookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Book on {chainLabel(confirm.result.session.chain)} ↗
                  </a>
                </span>
              </div>
              <SeatMapView
                map={confirm.map}
                topN={topN}
                highlightSeatIds={confirm.result.block?.seatIds}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
