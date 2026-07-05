import { chainLabel, formatTime } from "../format";
import { displayCinemaName, fitTierLabel, freshnessLabel, optionFormatBadge } from "./present";
import type { Option } from "./types";

interface Props {
  option: Option;
  party: number;
  selected: boolean;
  onSelect: (option: Option) => void;
}

/** One option card — cinema+day+time (scan), format+seat-signal+fit (judge), freshness (trust). */
export function OptionCard({ option, party, selected, onSelect }: Props) {
  const badge = optionFormatBadge(option);
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
          {displayCinemaName(option)} · {formatTime(option.startsAt)}
          {approximate && (
            <span
              className="confidence-chip confidence-chip--inline"
              title="Hoyts doesn't publish seat coordinates; positions are inferred from order."
              aria-label="Approximate seat geometry: Hoyts doesn't publish seat coordinates; positions are inferred from order."
            >
              (~)
            </span>
          )}
        </span>
        <span className="sess__meta">
          <span className="tag">{chainLabel(option.chain)}</span>
          {badge && (
            <span className="tag tag--format" data-premium="true">
              {badge.label}
            </span>
          )}
          <span className="tag tag--fit" data-tier={option.fitTier}>
            {fitTierLabel(option, party)}
          </span>
        </span>
        <span className="sess__sub">
          {option.bestBlockScore !== null ? `Best block score ${option.bestBlockScore} · ` : ""}
          {freshnessLabel(option.freshness)}
        </span>
      </span>
    </button>
  );
}
