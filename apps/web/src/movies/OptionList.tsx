import { useMemo, useState } from "react";
import { applyLens, LENSES, type Lens } from "./lenses";
import { OptionCard } from "./OptionCard";
import type { Option } from "./types";

interface Props {
  options: Option[];
  party: number;
  selectedSessionId: string | null;
  onSelectOption: (option: Option) => void;
}

/**
 * Option list: lens chips re-rank the SAME candidate set (no reload, no nav — contract §1.6).
 * "Most together" trusts server order untouched; the other three are client comparators.
 * Honest no-good-seats state (C1 wireframe 1b): shown when no option in the whole response clears
 * the quality bar, or when "Soonest good" specifically has nothing qualifying — the movie and its
 * sessions are never silently hidden.
 */
export function OptionList({ options, party, selectedSessionId, onSelectOption }: Props) {
  const [lens, setLens] = useState<Lens>("together");

  const { options: sorted, noQualifying } = useMemo(
    () => applyLens(options, lens),
    [options, lens],
  );

  const noneQualifyAtAll = options.length > 0 && options.every((o) => o.bestBlockScore === null);
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

      {options.length === 0 && (
        <div className="empty">No cached sessions for this movie yet.</div>
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
          {sorted.map((o) => (
            <OptionCard
              key={o.sessionId}
              option={o}
              party={party}
              selected={selectedSessionId === o.sessionId}
              onSelect={onSelectOption}
            />
          ))}
        </div>
      )}
    </div>
  );
}
