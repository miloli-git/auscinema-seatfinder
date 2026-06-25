import { render } from "@testing-library/react";
import { Matrix } from "./Matrix";
import { buildMatrix, cellKey, type TogetherResult, type TogetherBlock } from "../together/matrix";
import type { TogetherSession } from "../together/normalize";

function rawSession(over: Partial<TogetherSession> = {}): TogetherSession {
  return {
    id: "s1",
    chain: "event",
    movieId: "19796",
    movieName: "Supergirl",
    cinemaId: "A",
    cinemaName: "Cinema A",
    date: "2026-06-27",
    startTime: "2026-06-27T19:00:00.000Z",
    format: "IMAX",
    screen: null,
    seatsAvailable: 100,
    bookingUrl: "https://example.test/book/s1",
    seatAllocation: true,
    ...over,
  };
}

function block(avgScore: number): TogetherBlock {
  return { row: -7, rowLabel: "L", startCol: -18, seatIds: ["a", "b"], avgScore, minScore: avgScore };
}

function result(session: Partial<TogetherSession>, blk: TogetherBlock | null): TogetherResult {
  return { session: rawSession(session), block: blk, approximateAdjacency: false, fetchedAt: "x" };
}

const ALL = { formats: [] as never[], timePreset: "any" as const, minScore: 74 };

function fixture(): TogetherResult[] {
  return [
    result({ id: "a27", cinemaId: "A", cinemaName: "Cinema A", startTime: "2026-06-27T19:00:00.000Z" }, block(92)),
    result({ id: "a29", cinemaId: "A", cinemaName: "Cinema A", startTime: "2026-06-29T19:00:00.000Z" }, null),
    result({ id: "b28", cinemaId: "B", cinemaName: "Cinema B", startTime: "2026-06-28T19:00:00.000Z" }, block(70)),
  ];
}

describe("Matrix (L3.1)", () => {
  it("L3.1 renders rows = cinemas and cols = dates", () => {
    const model = buildMatrix(fixture(), ALL);
    const { container, getByText } = render(<Matrix model={model} onCellClick={() => {}} />);
    expect(getByText("Cinema A")).toBeInTheDocument();
    expect(getByText("Cinema B")).toBeInTheDocument();
    const dateHeaders = container.querySelectorAll("thead [data-date]");
    expect(dateHeaders).toHaveLength(3);
    expect([...dateHeaders].map((h) => h.getAttribute("data-date"))).toEqual([
      "2026-06-27",
      "2026-06-28",
      "2026-06-29",
    ]);
  });

  it("D1 renders date column headers with weekday, day, and month abbreviation", () => {
    const model = buildMatrix(
      [
        result(
          { id: "jul-2", cinemaId: "A", cinemaName: "Cinema A", startTime: "2026-07-02T19:00:00.000Z" },
          block(92),
        ),
      ],
      ALL,
    );
    const { container } = render(<Matrix model={model} onCellClick={() => {}} />);
    const header = container.querySelector('[data-date="2026-07-02"]');

    expect(header).not.toBeNull();
    expect(header?.textContent).toMatch(/Thu\s+2\s+Jul/);
    expect(header?.textContent).toMatch(/Jul/);
  });

  it("L3.1 first column is sticky (mobile class present)", () => {
    const model = buildMatrix(fixture(), ALL);
    const { container } = render(<Matrix model={model} onCellClick={() => {}} />);
    expect(container.querySelector(".matrix-sticky-col")).not.toBeNull();
    // every cinema row label carries the sticky class
    const rowLabels = container.querySelectorAll("tbody .matrix-sticky-col");
    expect(rowLabels).toHaveLength(2);
  });

  it("L3.1 clicking a score cell calls onCellClick(cinemaId, date); sold/empty do not", () => {
    const model = buildMatrix(fixture(), ALL);
    const clicks: Array<[string, string]> = [];
    const { container } = render(
      <Matrix model={model} onCellClick={(c, d) => clicks.push([c, d])} />,
    );
    const score = container.querySelector('[data-cinema="A"][data-date="2026-06-27"] button');
    expect(score).not.toBeNull();
    (score as HTMLButtonElement).click();
    expect(clicks).toEqual([["A", "2026-06-27"]]);

    // sold cell A/29 has no clickable button
    expect(container.querySelector('[data-cinema="A"][data-date="2026-06-29"] button')).toBeNull();
    // empty cell A/28 has no clickable button
    expect(container.querySelector('[data-cinema="A"][data-date="2026-06-28"] button')).toBeNull();
    expect(model.cells.get(cellKey("A", "2026-06-28"))).toEqual({ kind: "empty" });
  });
});
