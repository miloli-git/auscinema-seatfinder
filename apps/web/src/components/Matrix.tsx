import type { MatrixModel } from "../together/matrix";
import { cellKey } from "../together/matrix";
import { MatrixCell } from "./MatrixCell";

interface Props {
  model: MatrixModel;
  /** Fired when a score cell is clicked (sold / empty cells are inert). */
  onCellClick: (cinemaId: string, date: string) => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short column label from a YYYY-MM-DD date (UTC-stable, TZ-independent). */
function dateLabel(date: string): string {
  const dt = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

/**
 * The date × cinema matrix (L3.1). Rows = cinemas, columns = dates, for one
 * movie. The first column (cinema) is sticky for horizontal scroll on mobile.
 */
export function Matrix({ model, onCellClick }: Props) {
  return (
    <div className="matrixscroll">
      <table className="matrix">
        <thead>
          <tr>
            <th className="matrix-sticky-col matrix-corner" scope="col" aria-label="Cinema" />
            {model.dates.map((d) => (
              <th key={d} className="matrix-date" data-date={d} scope="col">
                {dateLabel(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.cinemas.map((c) => (
            <tr key={c.id}>
              <th className="matrix-sticky-col matrix-cinema" scope="row">
                {c.name}
              </th>
              {model.dates.map((d) => {
                const cell = model.cells.get(cellKey(c.id, d)) ?? { kind: "empty" as const };
                return (
                  <td key={d} className="matrix-td" data-cinema={c.id} data-date={d}>
                    <MatrixCell
                      cell={cell}
                      onClick={cell.kind === "score" ? () => onCellClick(c.id, d) : undefined}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
