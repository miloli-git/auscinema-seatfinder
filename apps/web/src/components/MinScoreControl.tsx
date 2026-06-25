interface Props {
  value: number;
  /** Re-query callback: a minScore change issues ONE new /together call rather
   *  than re-filtering the cache client-side (L3.7). */
  onMinScoreChange: (minScore: number) => void;
  min?: number;
  max?: number;
}

/**
 * minScore control. Its change handler calls the re-query callback (the matrix
 * re-fetches /together at the new minScore); format/time/day filters stay
 * client-side, but minScore is a server parameter so it must re-query.
 */
export function MinScoreControl({ value, onMinScoreChange, min = 0, max = 100 }: Props) {
  return (
    <label className="field minscore">
      <span>
        Min score <em>{value}</em>
      </span>
      <input
        type="range"
        aria-label="Min score"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onMinScoreChange(Number(e.target.value))}
      />
    </label>
  );
}
