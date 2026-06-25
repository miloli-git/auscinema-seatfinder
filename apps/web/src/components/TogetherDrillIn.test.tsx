import { render, fireEvent, waitFor } from "@testing-library/react";
import { TogetherDrillIn } from "./TogetherDrillIn";
import { DEFAULT_SCORING } from "../api";
import type { TogetherResult, TogetherBlock } from "../together/matrix";
import type { TogetherSession } from "../together/normalize";
import type { ScoredSeatMap, Seat } from "../types";

function rawSession(over: Partial<TogetherSession> = {}): TogetherSession {
  return {
    id: "s1",
    chain: "event",
    movieId: "19796",
    movieName: "Supergirl",
    cinemaId: "A",
    cinemaName: "Cinema A",
    date: "2026-06-27",
    startTime: "2026-06-27T19:30:00.000Z",
    format: "IMAX",
    screen: null,
    seatsAvailable: 100,
    bookingUrl: "https://example.test/book/s1",
    seatAllocation: true,
    ...over,
  };
}

function block(seatIds: string[], avgScore = 92): TogetherBlock {
  return { row: -7, rowLabel: "L", startCol: -18, seatIds, avgScore, minScore: avgScore };
}

function result(over: Partial<TogetherSession>, blk: TogetherBlock): TogetherResult {
  return {
    session: rawSession(over),
    block: blk,
    approximateAdjacency: false,
    fetchedAt: "2026-06-25T01:04:00.000Z",
  };
}

function seat(over: Partial<Seat> & { id: string; row: number; col: number }): Seat {
  return { rowLabel: "L", status: "available", areaId: "area1", ...over };
}

function seatMapWith(availableIds: string[]): ScoredSeatMap {
  const seats: Seat[] = availableIds.map((id, i) =>
    seat({ id, rowLabel: "L", row: 0, col: i + 1 }),
  );
  return {
    chain: "event",
    sessionId: "s1",
    areas: [{ id: "area1", name: "Stalls", kind: "standard" }],
    seats,
    scored: seats.map((s, i) => ({ seat: s, score: 90 - i })),
  };
}

describe("TogetherDrillIn (L3.3 / L3.5 / L3.6)", () => {
  it("L3.3 lists each qualifying session (time · format · block avg · 'as of')", () => {
    const results = [
      result({ id: "s1", startTime: "2026-06-27T19:30:00.000Z", format: "IMAX" }, block(["L1", "L2"], 92)),
      result({ id: "s2", startTime: "2026-06-27T21:15:00.000Z", format: "Standard" }, block(["M1", "M2"], 80)),
    ];
    const { getByText, container } = render(
      <TogetherDrillIn cinemaName="Cinema A" date="2026-06-27" results={results} fetchSeatMap={async () => seatMapWith([])} />,
    );
    expect(getByText(/Cinema A/)).toBeInTheDocument();
    // two session rows
    expect(container.querySelectorAll("[data-session-row]")).toHaveLength(2);
    // first row content
    expect(getByText(/7:30/)).toBeInTheDocument();
    expect(getByText(/IMAX/)).toBeInTheDocument();
    expect(getByText("92")).toBeInTheDocument();
    // "as of" stamp present
    expect(container.querySelector("[data-session-row]")?.textContent).toMatch(/as of/i);
  });

  it("L3.5 (#37) confirming a session requests /seatmap with the default scoring profile", async () => {
    const calls: Array<{ chain: string; id: string; scoring: unknown }> = [];
    const fetchSeatMap = async (chain: string, id: string, scoring: typeof DEFAULT_SCORING) => {
      calls.push({ chain, id, scoring });
      return seatMapWith(["L1", "L2"]);
    };
    const results = [result({ id: "s1", chain: "event" }, block(["L1", "L2"], 92))];
    const { container } = render(
      <TogetherDrillIn cinemaName="Cinema A" date="2026-06-27" results={results} fetchSeatMap={fetchSeatMap} />,
    );
    fireEvent.click(container.querySelector("[data-session-row]")!);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.chain).toBe("event");
    expect(calls[0]!.id).toBe("s1");
    expect(calls[0]!.scoring).toEqual(DEFAULT_SCORING);
    // block still present -> confirm shows the highlighted block
    await waitFor(() => expect(container.querySelectorAll(".seat--hi")).toHaveLength(2));
  });

  it("L3.6 (#38) when the live /seatmap no longer has the block -> 'block gone' state", async () => {
    // returns a map where one of the block seats is no longer available
    const fetchSeatMap = async () => seatMapWith(["L1"]); // L2 missing
    const results = [result({ id: "s1" }, block(["L1", "L2"], 92))];
    const { container, findByText } = render(
      <TogetherDrillIn cinemaName="Cinema A" date="2026-06-27" results={results} fetchSeatMap={fetchSeatMap} />,
    );
    fireEvent.click(container.querySelector("[data-session-row]")!);
    expect(await findByText(/block gone/i)).toBeInTheDocument();
    expect(container.querySelectorAll(".seat--hi")).toHaveLength(0);
  });
});
