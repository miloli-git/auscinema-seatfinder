interface Props {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  /** Used to build per-button aria-labels, e.g. "Decrease Tue 24 Jul headcount". */
  ariaLabelPrefix: string;
}

/**
 * Small-integer +/- stepper — explicitly NOT a slider (contract's Codex UX review, docs/47a-contract
 * §1.2 / design/journey/04-wireframes-c1-c2.md). Used for the solo party count and each per-day
 * headcount in Plan-group mode.
 */
export function Stepper({ label, value, onChange, min = 1, max = 20, ariaLabelPrefix }: Props) {
  return (
    <div className="stepper">
      <span className="stepper__label">{label}</span>
      <div className="stepper__control" role="group" aria-label={`${ariaLabelPrefix} headcount`}>
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Decrease ${ariaLabelPrefix} headcount`}
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
        >
          −
        </button>
        <span className="stepper__value" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Increase ${ariaLabelPrefix} headcount`}
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
        >
          +
        </button>
      </div>
    </div>
  );
}
