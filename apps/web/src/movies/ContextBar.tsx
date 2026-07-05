import { MinScoreControl } from "../components/MinScoreControl";
import { Stepper } from "./Stepper";

export interface DayCount {
  date: string; // YYYY-MM-DD
  label: string; // e.g. "Tue 21 Jul"
  count: number;
}

interface Props {
  groupMode: boolean;
  onToggleGroupMode: (on: boolean) => void;
  soloParty: number;
  onSoloPartyChange: (n: number) => void;
  minScore: number;
  onMinScoreChange: (n: number) => void;
  days: DayCount[];
  onDayCountChange: (date: string, count: number) => void;
  onSkipToResults: () => void;
}

/**
 * Context bar (wireframe Screen 1 spine): assumed defaults shown up front, a visible "Plan group"
 * persona toggle (not a hidden tap), and a skip-to-results affordance so the solo path stays one
 * tap to results. Plan-group mode reveals per-day STEPPERS (small integers, never a slider) — one
 * per day that actually has a screening in the current option list.
 *
 * Honesty constraint (contract §1.2): /options takes exactly one scalar `party`. The per-day
 * steppers are UI state only; the day-varying headcounts feed a single derived party value (this
 * build uses the contract's own recommendation — max of the entered per-day counts, since that is
 * the binding constraint for "most together"). No per-day server-side ranking is implied anywhere
 * in this bar's copy.
 */
export function ContextBar({
  groupMode,
  onToggleGroupMode,
  soloParty,
  onSoloPartyChange,
  minScore,
  onMinScoreChange,
  days,
  onDayCountChange,
  onSkipToResults,
}: Props) {
  return (
    <div className="contextbar">
      <div className="contextbar__row">
        <div className="modetoggle" role="tablist" aria-label="Just me or plan a group">
          <button
            type="button"
            role="tab"
            aria-selected={!groupMode}
            className={`btn btn--ghost${!groupMode ? " btn--on" : ""}`}
            onClick={() => onToggleGroupMode(false)}
          >
            Just me
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={groupMode}
            className={`btn btn--ghost${groupMode ? " btn--on" : ""}`}
            onClick={() => onToggleGroupMode(true)}
          >
            Plan group
          </button>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onSkipToResults}>
          Skip to results ↓
        </button>
      </div>

      {!groupMode && (
        <div className="contextbar__row">
          <Stepper
            label="Party"
            value={soloParty}
            onChange={onSoloPartyChange}
            min={1}
            ariaLabelPrefix="Party"
          />
          <MinScoreControl value={minScore} onMinScoreChange={onMinScoreChange} />
        </div>
      )}

      {groupMode && (
        <div className="contextbar__group">
          <p className="contextbar__grouphint">How many likely each day?</p>
          <div className="contextbar__days">
            {days.length === 0 && (
              <p className="hint">No cached sessions yet to plan days against.</p>
            )}
            {days.map((d) => (
              <Stepper
                key={d.date}
                label={d.label}
                value={d.count}
                onChange={(n) => onDayCountChange(d.date, n)}
                min={1}
                ariaLabelPrefix={d.label}
              />
            ))}
          </div>
          <p className="hint">
            We use the largest day&rsquo;s headcount as the group size for ranking — the option list
            can&rsquo;t yet judge each day&rsquo;s turnout separately.
          </p>
          <MinScoreControl value={minScore} onMinScoreChange={onMinScoreChange} />
        </div>
      )}
    </div>
  );
}
