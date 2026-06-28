import type { RankedSession } from "../types";
import { formatBadge, formatTime, scoreBand } from "../format";

interface Props {
  ranked: RankedSession;
  selected: boolean;
  onSelect: (session: RankedSession["session"]) => void;
}

/** One row in the ranked rail. Selecting it drives the hero seat map. */
export function SessionCard({ ranked, selected, onSelect }: Props) {
  const { session, bestScore } = ranked;
  const band = scoreBand(bestScore);
  const badge = formatBadge(session.format);

  return (
    <button type="button" className="sess" aria-pressed={selected} onClick={() => onSelect(session)}>
      <span className="scorepill" data-band={band}>
        <b>{bestScore}</b>
        <span>best</span>
      </span>
      <span>
        <span className="sess__time">{formatTime(session.startTime)}</span>
        {(badge || session.screenName) && (
          <span className="sess__meta">
            {badge && (
              <span
                className="tag tag--format"
                data-format={session.format.kind}
                {...(badge.premium ? { "data-premium": "true" } : {})}
              >
                {badge.label}
              </span>
            )}
            {session.screenName && <span className="sess__sub">Screen {session.screenName}</span>}
          </span>
        )}
        <span className="sess__sub">
          {session.cinemaName || session.cinemaId}
          {typeof session.seatsAvailable === "number" ? ` · ${session.seatsAvailable} free` : ""}
        </span>
      </span>
    </button>
  );
}
