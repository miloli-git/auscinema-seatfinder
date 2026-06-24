import { useMemo } from "react";
import type { ScoredSeatMap, Seat } from "../types";
import { seatQuality } from "../format";

interface Props {
  map: ScoredSeatMap;
  topN: number;
}

/** SOLD / unavailable / special / companion all read as "not selectable" on the heatmap. */
function isTaken(status: Seat["status"]): boolean {
  return status === "sold" || status === "unavailable" || status === "special" || status === "companion";
}

export function SeatMapView({ map, topN }: Props) {
  const scoreById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of map.scored) m.set(s.seat.id, s.score);
    return m;
  }, [map.scored]);

  const topIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of map.scored.slice(0, topN)) ids.add(s.seat.id);
    return ids;
  }, [map.scored, topN]);

  const bounds = useMemo(() => {
    let minRow = Infinity;
    let maxRow = -Infinity;
    let minCol = Infinity;
    let maxCol = -Infinity;
    for (const s of map.seats) {
      if (s.row < minRow) minRow = s.row;
      if (s.row > maxRow) maxRow = s.row;
      if (s.col < minCol) minCol = s.col;
      if (s.col > maxCol) maxCol = s.col;
    }
    return { minRow, maxRow, minCol, maxCol };
  }, [map.seats]);

  if (!Number.isFinite(bounds.minRow)) {
    return <p className="hint">No seat geometry for this session.</p>;
  }

  const cols = bounds.maxCol - bounds.minCol + 1;
  const rows = new Map<number, (Seat | undefined)[]>();
  for (const s of map.seats) {
    const r = s.row - bounds.minRow;
    let arr = rows.get(r);
    if (!arr) {
      arr = new Array<Seat | undefined>(cols).fill(undefined);
      rows.set(r, arr);
    }
    arr[s.col - bounds.minCol] = s;
  }
  const orderedRows = [...rows.entries()].sort((a, b) => a[0] - b[0]);
  const areaName = (areaId: string) => map.areas.find((a) => a.id === areaId)?.name ?? "";

  return (
    <>
      <div className="screen" aria-hidden="true">
        SCREEN
      </div>

      <div className="mapscroll">
        <div
          className="grid"
          role="img"
          aria-label="Auditorium seat map. Best available seats are outlined; colour shows seat quality from green (best) to dim (poor)."
        >
          {orderedRows.map(([r, arr]) => {
            const label = arr.find((s) => s)?.rowLabel ?? "";
            return (
              <div className="row" key={r}>
                <span className="row__lab">{label}</span>
                <div className="seats">
                  {arr.map((seat, ci) => {
                    if (!seat || seat.status === "spacer") {
                      return <span key={ci} className="seat" data-q="gap" aria-hidden />;
                    }
                    if (isTaken(seat.status)) {
                      return <span key={ci} className="seat" data-q="sold" aria-hidden />;
                    }
                    const score = scoreById.get(seat.id);
                    const q = typeof score === "number" ? seatQuality(score) : "weak";
                    const isTop = topIds.has(seat.id);
                    const title = [
                      seat.name ?? `${seat.rowLabel}${seat.col}`,
                      areaName(seat.areaId),
                      typeof score === "number" ? `score ${score}` : seat.status,
                      isTop ? "best pick" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <span
                        key={ci}
                        className="seat"
                        data-q={q}
                        {...(isTop ? { "data-best": "" } : {})}
                        {...(seat.paired ? { "data-paired": "" } : {})}
                        title={title}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="hero__foot">
        <span className="ramp">
          poor
          <span className="ramp__bar" aria-hidden="true">
            <i style={{ background: "var(--q-weak)" }} />
            <i style={{ background: "var(--q-ok)" }} />
            <i style={{ background: "var(--q-good)" }} />
            <i style={{ background: "var(--q-great)" }} />
            <i style={{ background: "var(--q-elite)" }} />
          </span>
          best
        </span>
        <span className="legend">
          <span>
            <span className="sw sw--best" /> best pick
          </span>
          <span>
            <span className="sw sw--sold" /> sold
          </span>
        </span>
        <span className="classes">
          {map.areas.map((a) => (
            <span key={a.id} className="tag">
              {a.name}
            </span>
          ))}
        </span>
      </div>
    </>
  );
}
