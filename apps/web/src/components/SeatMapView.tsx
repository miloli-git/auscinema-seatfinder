import { useMemo } from "react";
import type { ScoredSeatMap, Seat } from "../types";

interface Props {
  map: ScoredSeatMap;
  topN: number;
}

/** Lerp a 0–100 score onto a cool→hot fill. Higher score = brighter/greener. */
function scoreFill(score: number): string {
  const t = Math.max(0, Math.min(1, score / 100));
  // weak (slate) -> strong (amber/green). Hue 210 (blue) -> 145 (green).
  const hue = 210 - t * 65;
  const light = 26 + t * 30;
  const sat = 30 + t * 45;
  return `hsl(${hue} ${sat}% ${light}%)`;
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

  // Group seats by normalised row, indexed by column offset.
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

  const areaName = (areaId: string) =>
    map.areas.find((a) => a.id === areaId)?.name ?? "";

  return (
    <div className="seatmap">
      <div className="seatmap__screen">SCREEN</div>

      <div className="seatmap__grid" role="grid" aria-label="Seat map">
        {orderedRows.map(([r, arr]) => {
          const label = arr.find((s) => s)?.rowLabel ?? "";
          return (
            <div className="seatrow" key={r} role="row">
              <span className="seatrow__label">{label}</span>
              <div className="seatrow__seats" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                {arr.map((seat, ci) => {
                  if (!seat || seat.status === "spacer") {
                    return <span key={ci} className="seat seat--gap" aria-hidden />;
                  }
                  const isAvail = seat.status === "available";
                  const score = scoreById.get(seat.id);
                  const isTop = topIds.has(seat.id);
                  const style =
                    isAvail && typeof score === "number"
                      ? { background: scoreFill(score) }
                      : undefined;
                  const cls = [
                    "seat",
                    `seat--${seat.status}`,
                    isTop ? "seat--top" : "",
                    seat.paired ? "seat--paired" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const title = [
                    seat.name ?? `${seat.rowLabel}${seat.col}`,
                    areaName(seat.areaId),
                    isAvail ? `score ${score ?? "-"}` : seat.status,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <span key={ci} className={cls} style={style} title={title} role="gridcell">
                      {isTop ? "★" : ""}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="seatmap__footer">
        <div className="legend">
          <span className="legend__item">
            <span className="swatch" style={{ background: scoreFill(95) }} /> top score
          </span>
          <span className="legend__item">
            <span className="swatch" style={{ background: scoreFill(40) }} /> lower score
          </span>
          <span className="legend__item">
            <span className="swatch swatch--sold" /> sold
          </span>
          <span className="legend__item">
            <span className="swatch swatch--top" /> ★ best pick
          </span>
        </div>
        <div className="areas-list">
          {map.areas.map((a) => (
            <span key={a.id} className="tag tag--area">
              {a.name} <small>({a.kind})</small>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
