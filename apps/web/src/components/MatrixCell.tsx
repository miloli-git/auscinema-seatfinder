import type { MatrixCell as Cell } from "../together/matrix";
import { seatQuality } from "../format";

interface Props {
  cell: Cell;
  /** Provided only for score cells; clicking opens the drill-in. */
  onClick?: () => void;
}

/**
 * One matrix cell (L3.2). Renders the best block score (colour-banded via the
 * shared seat-quality bands), "sold" (sessions exist, none bookable), or "—"
 * (no session in window). Only score cells are interactive.
 */
export function MatrixCell({ cell, onClick }: Props) {
  if (cell.kind === "score") {
    const q = seatQuality(cell.avgScore);
    return (
      <button
        type="button"
        className="matrix-cell matrix-cell--score"
        data-q={q}
        onClick={onClick}
        title={`Best block avg ${cell.avgScore} · ${cell.sessionCount} session${
          cell.sessionCount === 1 ? "" : "s"
        }`}
      >
        {cell.avgScore}
      </button>
    );
  }
  if (cell.kind === "sold") {
    return (
      <span className="matrix-cell matrix-cell--sold" title="Sessions exist but no adjacent block">
        sold
      </span>
    );
  }
  return (
    <span className="matrix-cell matrix-cell--empty" aria-label="no session">
      —
    </span>
  );
}
