import { chainLabel, formatShortDate, formatTime } from "../format";
import { displayCinemaName, fitTierLabel, freshnessLabel, optionFormatBadge } from "./present";
import type { Option } from "./types";

interface Props {
  option: Option;
  party: number;
  selected: boolean;
  onSelect: (option: Option) => void;
}

/**
 * One option card — cinema+DATE+time (scan), format+seat-signal+fit (judge), freshness (trust).
 *
 * 47c fixes #1/#2: the card used to render clock time ONLY (`cinema · 3:15 PM`), so a flat 46-card
 * list spanning 10+ days had cards differing only by freshness — genuinely ambiguous which of
 * several real, distinct, bookable sessions a card referred to. `option.date` always existed in the
 * payload but was never read here. Now every card leads with its own date.
 */
export function OptionCard({ option, party, selected, onSelect }: Props) {
  const badge = optionFormatBadge(option);
  const fitLabel = fitTierLabel(option, party);
  const approximate = option.geometryConfidence === "approximate";

  return (
    <button
      type="button"
      className="sess optioncard"
      aria-pressed={selected}
      onClick={() => onSelect(option)}
    >
      <span className="optioncard__main">
        <span className="sess__time">
          <span className="sess__date">{formatShortDate(option.date)}</span> ·{" "}
          {displayCinemaName(option)} · {formatTime(option.startsAt)}
        </span>
        <span className="sess__meta">
          <span className="tag">{chainLabel(option.chain)}</span>
          {badge && (
            <span className="tag tag--format" data-premium="true">
              {badge.label}
            </span>
          )}
          {fitLabel && (
            <span className="tag tag--fit" data-tier={option.fitTier}>
              {fitLabel}
            </span>
          )}
          {approximate && (
            // 47c fix #14: the old "(~)" glyph relied entirely on hover/ARIA for meaning. Use the
            // same visible copy as SeatMapView's own chip ("Seat positions approximate") so the
            // caveat reads the same wherever it appears, not a cryptic short form on cards only.
            <span
              className="confidence-chip"
              title="Hoyts doesn't publish seat coordinates; positions are inferred from order."
              aria-label="Seat positions approximate: Hoyts doesn't publish seat coordinates; positions are inferred from order."
            >
              Seat positions approximate
            </span>
          )}
        </span>
        <span className="sess__sub">
          {/* 47c fix #9: "Soonest good" is now a pure re-rank (never a silent filter) — a
             non-qualifying card needs its own explicit state rather than just omitting the score. */}
          {option.bestBlockScore !== null
            ? `Best block score ${option.bestBlockScore} · `
            : "No qualifying block · "}
          {freshnessLabel(option.freshness)}
        </span>
      </span>
    </button>
  );
}
