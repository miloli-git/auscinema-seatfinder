import { render, fireEvent, waitFor } from "@testing-library/react";
import { TogetherDrillIn } from "./TogetherDrillIn";
import { DEFAULT_SCORING } from "../api";
import type { TogetherResult, TogetherBlock } from "../together/matrix";
import type { TogetherSession } from "../together/normalize";
import type { ScoredSeatMap, Seat } from "../types";

type LiveSeatMapOptions = { party?: number; minScore?: number };
type LiveScoredSeatMap = ScoredSeatMap & {
  block?: TogetherBlock | null;
  blocks?: TogetherBlock[];
};

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

function result(over: Partial<TogetherSession>, blk: TogetherBlock | null): TogetherResult {
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

function seatMapWith(availableIds: string[], liveBlock?: TogetherBlock | null): LiveScoredSeatMap {
  const seats: Seat[] = availableIds.map((id, i) =>
    seat({ id, rowLabel: "L", row: 0, col: i + 1 }),
  );
  return {
    chain: "event",
    sessionId: "s1",
    areas: [{ id: "area1", name: "Stalls", kind: "standard" }],
    seats,
    scored: seats.map((s, i) => ({ seat: s, score: 90 - i })),
    ...(liveBlock === undefined ? {} : { block: liveBlock, blocks: liveBlock ? [liveBlock] : [] }),
  };
}

function highlightedSeatIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".seat--hi")].map((el) => el.getAttribute("data-seat-id") ?? "");
}

describe("TogetherDrillIn live recompute confirm", () => {
  it("lists each qualifying session with time, format, block average, and as-of stamp", () => {
    const results = [
      result({ id: "s1", startTime: "2026-06-27T19:30:00.000Z", format: "IMAX" }, block(["L1", "L2"], 92)),
      result({ id: "s2", startTime: "2026-06-27T21:15:00.000Z", format: "Standard" }, block(["M1", "M2"], 80)),
    ];
    const { getByText, container } = render(
      <TogetherDrillIn
        cinemaName="Cinema A"
        date="2026-06-27"
        results={results}
        party={2}
        minScore={74}
        fetchSeatMap={async () => seatMapWith([])}
      />,
    );

    expect(getByText(/Cinema A/)).toBeInTheDocument();
    expect(container.querySelectorAll("[data-session-row]")).toHaveLength(2);
    expect(getByText(/7:30/)).toBeInTheDocument();
    expect(getByText(/IMAX/)).toBeInTheDocument();
    expect(getByText("92")).toBeInTheDocument();
    expect(container.querySelector("[data-session-row]")?.textContent).toMatch(/as of/i);
  });

  it("passes party and minScore to /seatmap, then highlights the live block when it differs from cached", async () => {
    const calls: Array<{
      chain: string;
      id: string;
      scoring: typeof DEFAULT_SCORING;
      options?: LiveSeatMapOptions;
    }> = [];
    const cachedBlock = block(["C1", "C2"], 91);
    const liveBlock = block(["L3", "L4"], 95);
    const fetchSeatMap = async (
      chain: string,
      id: string,
      scoring: typeof DEFAULT_SCORING,
      options?: LiveSeatMapOptions,
    ): Promise<LiveScoredSeatMap> => {
      calls.push({ chain, id, scoring, options });
      return seatMapWith(["C1", "C2", "L3", "L4"], liveBlock);
    };
    const results = [result({ id: "s1", chain: "event" }, cachedBlock)];
    const { container, getByText } = render(
      <TogetherDrillIn
        cinemaName="Cinema A"
        date="2026-06-27"
        results={results}
        party={4}
        minScore={81}
        fetchSeatMap={fetchSeatMap}
      />,
    );

    fireEvent.click(container.querySelector("[data-session-row]")!);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      chain: "event",
      id: "s1",
      scoring: DEFAULT_SCORING,
      options: { party: 4, minScore: 81 },
    });

    await waitFor(() => expect(container.querySelectorAll(".seat--hi")).toHaveLength(2));
    expect(highlightedSeatIds(container)).toEqual(["L3", "L4"]);
    expect(highlightedSeatIds(container)).not.toEqual(cachedBlock.seatIds);
    expect(getByText(/moments ago/i)).toBeInTheDocument();
  });

  it("uses the live null block for gone state and does not advise re-running the stale search", async () => {
    const cachedBlock = block(["C1", "C2"], 91);
    const fetchSeatMap = async (): Promise<LiveScoredSeatMap> => seatMapWith(["C1", "C2"], null);
    const results = [result({ id: "s1" }, cachedBlock)];
    const { container, findByText, queryByText } = render(
      <TogetherDrillIn
        cinemaName="Cinema A"
        date="2026-06-27"
        results={results}
        party={3}
        minScore={74}
        fetchSeatMap={fetchSeatMap}
      />,
    );

    fireEvent.click(container.querySelector("[data-session-row]")!);

    const gone = await findByText(/those seats just went/i);
    expect(gone.textContent).toMatch(/moments ago/i);
    expect(gone.textContent).toMatch(/no adjacent 3 left/i);
    expect(queryByText(/re-run the search/i)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".seat--hi")).toHaveLength(0);
  });
});
