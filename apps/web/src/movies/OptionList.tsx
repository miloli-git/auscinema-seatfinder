import { useEffect, useMemo, useRef, useState } from "react";
import { formatShortDate } from "../format";
import { applyLens, LENSES, type Lens } from "./lenses";
import { OptionCard } from "./OptionCard";
import type { Option } from "./types";

interface Props {
  options: Option[];
  party: number;
  /** 47c fix #8: default lens depends on mode — Best seats (solo) vs Most together (group). */
  groupMode: boolean;
  selectedSessionId: string | null;
  onSelectOption: (option: Option) => void;
  /** 47c fixes #2/#5: the day filter is lifted to MovieFirstView so a DateAvailabilityStrip cell
   *  click (in the booking-detail panel, a sibling of this list) can drive it too. `null` = "all
   *  days" (default). */
  dayFilter: string | null;
  onDayFilterChange: (date: string | null) => void;
}

function defaultLensFor(groupMode: boolean): Lens {
  return groupMode ? "together" : "seats";
}

/**
 * Option list: lens chips re-rank the SAME candidate set (no reload, no nav — contract §1.6).
 * "Most together" trusts server order untouched; the other three are client comparators.
 * Honest no-good-seats state (C1 wireframe 1b): shown when no option in the whole response clears
 * the quality bar, or when "Soonest good" specifically has nothing qualifying — the movie and its
 * sessions are never silently hidden.
 *
 * 47c fixes #1/#2: the option list used to be one flat, dateless rail — genuinely ambiguous which of
 * several real, distinct sessions a card referred to once more than one day was cached. Now: a day
 * filter chip row narrows to one day (ties into fix #5's date-strip action), and "All days" (the
 * default) groups cards under a day heading whenever the date changes from the previous card in the
 * CURRENT lens order — grouping augments the lens ranking, it never re-sorts by date underneath it.
 */
export function OptionList({
  options,
  party,
  groupMode,
  selectedSessionId,
  onSelectOption,
  dayFilter,
  onDayFilterChange,
}: Props) {
  const [lens, setLens] = useState<Lens>(defaultLensFor(groupMode));
  const prevGroupMode = useRef(groupMode);

  // 47c fix #8: switching between solo/group is a big enough context change to reset the lens to
  // that mode's own sensible default — but only on an actual mode flip, never on every render.
  useEffect(() => {
    if (prevGroupMode.current !== groupMode) {
      setLens(defaultLensFor(groupMode));
      prevGroupMode.current = groupMode;
    }
  }, [groupMode]);

  const distinctDays = useMemo(() => {
    const seen = new Set<string>();
    const days: string[] = [];
    for (const o of options) {
      if (!seen.has(o.date)) {
        seen.add(o.date);
        days.push(o.date);
      }
    }
    return days.sort();
  }, [options]);

  // Day filter narrows the FULL candidate set before the lens ranks it — filtering is a distinct
  // concern from re-ranking, so a lens flip never resets or interacts with the chosen day.
  const dayFiltered = useMemo(
    () => (dayFilter ? options.filter((o) => o.date === dayFilter) : options),
    [options, dayFilter],
  );

  const { options: sorted, noQualifying } = useMemo(
    () => applyLens(dayFiltered, lens),
    [dayFiltered, lens],
  );

  const noneQualifyAtAll = dayFiltered.length > 0 && dayFiltered.every((o) => o.bestBlockScore === null);
  const showHonestState = noneQualifyAtAll || noQualifying;

  return (
    <div className="optionlist">
      <div className="chips" role="tablist" aria-label="Sort options by">
        {LENSES.map((l) => (
          <button
            key={l.value}
            type="button"
            role="tab"
            aria-selected={lens === l.value}
            aria-label={`${l.label} lens`}
            className={`chip${lens === l.value ? " chip--on" : ""}`}
            onClick={() => setLens(l.value)}
          >
            {l.label}
          </button>
        ))}
      </div>

      {distinctDays.length > 1 && (
        <div className="chips optionlist__dayfilter" role="tablist" aria-label="Filter by day">
          <button
            type="button"
            role="tab"
            aria-selected={dayFilter === null}
            className={`chip${dayFilter === null ? " chip--on" : ""}`}
            onClick={() => onDayFilterChange(null)}
          >
            All days
          </button>
          {distinctDays.map((date) => (
            <button
              key={date}
              type="button"
              role="tab"
              aria-selected={dayFilter === date}
              className={`chip${dayFilter === date ? " chip--on" : ""}`}
              onClick={() => onDayFilterChange(date)}
            >
              {formatShortDate(date)}
            </button>
          ))}
        </div>
      )}

      {options.length === 0 && (
        <div className="empty">No cached sessions for this movie yet.</div>
      )}

      {options.length > 0 && dayFiltered.length === 0 && (
        <div className="empty">No cached sessions on {dayFilter ? formatShortDate(dayFilter) : "this day"}.</div>
      )}

      {showHonestState && (
        <div className="banner banner--honest" role="status">
          <strong>No great seats left nearby right now.</strong>{" "}
          {noQualifying
            ? "No session yet has a qualifying block for your party — showing every cached session, soonest first."
            : "Nothing here clears your quality bar. Showing every cached session anyway — a later session or a lower min score may do better."}
        </div>
      )}

      {sorted.length > 0 && (
        <div className="rail rail--options">
          {sorted.map((o, i) => {
            const showDayHeader =
              distinctDays.length > 1 &&
              dayFilter === null &&
              (i === 0 || sorted[i - 1]!.date !== o.date);
            return (
              <div key={o.sessionId} className="optionlist__group">
                {showDayHeader && (
                  <h3 className="optionlist__daybreak">{formatShortDate(o.date)}</h3>
                )}
                <OptionCard
                  option={o}
                  party={party}
                  selected={selectedSessionId === o.sessionId}
                  onSelect={onSelectOption}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
