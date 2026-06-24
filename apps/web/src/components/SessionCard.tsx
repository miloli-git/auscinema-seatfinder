import type { RankedSession } from "../types";
import { formatLabel, formatTime, scoreBand } from "../format";

interface Props {
  ranked: RankedSession;
  selected: boolean;
  onSelect: () => void;
}

export function SessionCard({ ranked, selected, onSelect }: Props) {
  const { session, bestScore } = ranked;
  const band = scoreBand(bestScore);

  return (
    <article className={`card${selected ? " card--selected" : ""}`}>
      <button className="card__main" onClick={onSelect} type="button">
        <div className={`score score--${band}`}>
          <span className="score__num">{bestScore}</span>
          <span className="score__label">best seat</span>
        </div>
        <div className="card__body">
          <div className="card__time">{formatTime(session.startTime)}</div>
          <div className="card__meta">
            <span className="tag">{formatLabel(session.format)}</span>
            {session.screenName && <span className="muted">Screen {session.screenName}</span>}
          </div>
          <div className="card__sub">
            <span className="muted">{session.cinemaName}</span>
            {typeof session.seatsAvailable === "number" && (
              <span className="muted"> · {session.seatsAvailable} seats free</span>
            )}
          </div>
        </div>
      </button>
      <a
        className="btn btn--book"
        href={session.bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        Book on Event Cinemas ↗
      </a>
    </article>
  );
}
