import { render } from "@testing-library/react";
import { SeatMapView } from "./SeatMapView";
import type { ScoredSeatMap, Seat } from "../types";

function seat(over: Partial<Seat> & { id: string; row: number; col: number }): Seat {
  return {
    rowLabel: "A",
    status: "available",
    areaId: "area1",
    ...over,
  };
}

function map(): ScoredSeatMap {
  const seats: Seat[] = [
    seat({ id: "A1", rowLabel: "A", row: 0, col: 1 }),
    seat({ id: "A2", rowLabel: "A", row: 0, col: 2 }),
    seat({ id: "A3", rowLabel: "A", row: 0, col: 3 }),
    seat({ id: "A4", rowLabel: "A", row: 0, col: 4, status: "sold" }),
  ];
  return {
    chain: "event",
    sessionId: "s1",
    areas: [{ id: "area1", name: "Stalls", kind: "standard" }],
    seats,
    scored: [
      { seat: seats[0]!, score: 90 },
      { seat: seats[1]!, score: 80 },
      { seat: seats[2]!, score: 70 },
    ],
  };
}

describe("SeatMapView highlightSeatIds (L3.4 / #36)", () => {
  it("L3.4 applies the highlight class to exactly the seats in highlightSeatIds", () => {
    const { container } = render(<SeatMapView map={map()} topN={3} highlightSeatIds={["A2", "A3"]} />);
    const hi = [...container.querySelectorAll(".seat--hi")];
    const ids = hi.map((el) => el.getAttribute("data-seat-id")).sort();
    expect(ids).toEqual(["A2", "A3"]);
  });

  it("L3.4 no highlightSeatIds -> no seat carries the highlight class (existing behaviour intact)", () => {
    const { container } = render(<SeatMapView map={map()} topN={3} />);
    expect(container.querySelectorAll(".seat--hi")).toHaveLength(0);
    // still renders the heatmap seats
    expect(container.querySelector('[data-seat-id="A1"]')).not.toBeNull();
  });

  it("L3.4 highlight ids that are not present simply highlight nothing extra", () => {
    const { container } = render(<SeatMapView map={map()} topN={3} highlightSeatIds={["ZZ"]} />);
    expect(container.querySelectorAll(".seat--hi")).toHaveLength(0);
  });
});
