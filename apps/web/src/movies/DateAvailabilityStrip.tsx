// Compact date strip (docs/47b-contract.md §6) — one cell per cached day across the horizon.
// Grayscale by design (Slice 4 scope): the 5 states are distinguished by border weight/style and a
// short text label, never by color alone. Native <button> cells give free keyboard tab order and
// :focus-visible (styles.css's global rule) without any custom key-handling.

import { cellAccessibleLabel, cellStateLabel } from "./availabilityPresent";
import type { AvailabilityDate, AvailabilityResponse } from "./types";

interface Props {
  availability: AvailabilityResponse;
}

function dayNumber(date: string): string {
  const d = date.split("-")[2];
  return d ? String(Number(d)) : date;
}

export function DateAvailabilityStrip({ availability }: Props) {
  if (availability.dates.length === 0) {
    // Honest degrade (spec item 4): no cached dates at all is a real, distinct empty state — never
    // silently render a strip of nothing with no explanation.
    return (
      <p className="hint" role="status">
        No cached dates yet for this movie.
      </p>
    );
  }

  return (
    <div className="datestrip" role="group" aria-label="Date availability">
      {availability.dates.map((d: AvailabilityDate) => (
        <button
          key={d.date}
          type="button"
          className="datestrip__cell"
          data-state={d.state}
          aria-label={cellAccessibleLabel(d, availability)}
          title={cellAccessibleLabel(d, availability)}
        >
          <span className="datestrip__daynum">{dayNumber(d.date)}</span>
          <span className="datestrip__label">{cellStateLabel(d, availability)}</span>
        </button>
      ))}
    </div>
  );
}
