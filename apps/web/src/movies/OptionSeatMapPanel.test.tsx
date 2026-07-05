import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OptionSeatMapPanel } from "./OptionSeatMapPanel";
import type { AvailabilityResponse } from "./types";
import type { Option } from "./types";
import type { ScoredSeatMap, Seat } from "../types";

/** Flush pending promise microtasks under fake timers (no real `setTimeout` involved in the
 *  component itself, so a couple of resolved-promise ticks is enough to settle the fetch effects). */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * #46 fix (item 4/6): the seat-map fetch effect used to list `party`/`minScore` as live
 * dependencies, so every debounced slider tweak re-fired a LIVE /seatmap call (a real upstream
 * chain fetch every time — the RCA's 429 source). This asserts the fetch fires exactly once per
 * selected session across a run of minScore/party changes, and that the "together" highlight still
 * updates (derived client-side, no new fetch).
 */

function seat(over: Partial<Seat> & { id: string; row: number; col: number }): Seat {
  return { rowLabel: "A", status: "available", areaId: "area1", ...over };
}

function scoredMap(): ScoredSeatMap {
  const seats: Seat[] = [
    seat({ id: "A1", rowLabel: "A", row: 0, col: 1 }),
    seat({ id: "A2", rowLabel: "A", row: 0, col: 2 }),
  ];
  return {
    chain: "event",
    sessionId: "evt-9001",
    areas: [{ id: "area1", name: "Stalls", kind: "standard" }],
    seats,
    geometryConfidence: "exact",
    scored: [
      { seat: seats[0]!, score: 90 }, // qualifies at minScore 74 and 90
      { seat: seats[1]!, score: 60 }, // qualifies only at minScore 50
    ],
  };
}

const OPTION: Option = {
  chain: "event",
  cinemaId: "C1",
  cinemaName: "Event George Street",
  sessionId: "evt-9001",
  startsAt: "2026-08-10T19:00:00.000Z",
  date: "2026-08-10",
  format: "",
  isLargeFormat: false,
  formatRank: 0,
  bestBlockScore: null,
  bestBlockSize: null,
  fitTier: "together",
  togetherCount: 1,
  geometryConfidence: "exact",
  freshness: { asOf: "2026-08-01T00:00:00.000Z", state: "fresh" },
  bookingUrl: "https://example.test/book",
};

const EMPTY_AVAILABILITY: AvailabilityResponse = {
  movieKey: "event:555",
  cinemaId: "C1",
  party: 1,
  minScore: 74,
  horizonDate: "2026-09-14",
  maxCachedDate: "2026-08-10",
  earliest: null,
  earliestLeadDays: null,
  dates: [],
};

describe("#46 OptionSeatMapPanel fetch-once-per-session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches the seat map exactly once across a run of minScore changes for the same session", async () => {
    const fetchSeatMap = vi.fn().mockResolvedValue(scoredMap());
    const fetchAvailability = vi.fn().mockResolvedValue(EMPTY_AVAILABILITY);

    const { rerender, container } = render(
      <OptionSeatMapPanel
        option={OPTION}
        movieKey="event:555"
        party={1}
        minScore={90}
        onClose={() => {}}
        fetchSeatMap={fetchSeatMap}
        fetchAvailability={fetchAvailability}
      />,
    );

    await flush();
    expect(fetchSeatMap).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".hero__msg")).toBeNull();

    // At minScore 90, only the score-90 seat qualifies for a size-1 block.
    expect(container.querySelector('[data-seat-id="A1"]')?.hasAttribute("data-highlight")).toBe(true);
    expect(container.querySelector('[data-seat-id="A2"]')?.hasAttribute("data-highlight")).toBe(false);

    // Simulate a run of debounced slider values, same session — must NOT re-fetch.
    for (const minScore of [85, 74, 60, 50]) {
      rerender(
        <OptionSeatMapPanel
          option={OPTION}
          movieKey="event:555"
          party={1}
          minScore={minScore}
          onClose={() => {}}
          fetchSeatMap={fetchSeatMap}
          fetchAvailability={fetchAvailability}
        />,
      );
      await flush();
    }

    // party=1 always highlights just the single best-scoring seat (A1), regardless of how far
    // minScore drops — no new fetch across the whole run.
    expect(container.querySelector('[data-seat-id="A1"]')?.hasAttribute("data-highlight")).toBe(true);
    expect(fetchSeatMap).toHaveBeenCalledTimes(1);

    // Party change to 2 (still same session, minScore 50 lets BOTH seats qualify) must derive a
    // contiguous 2-seat block client-side — no new fetch.
    rerender(
      <OptionSeatMapPanel
        option={OPTION}
        movieKey="event:555"
        party={2}
        minScore={50}
        onClose={() => {}}
        fetchSeatMap={fetchSeatMap}
        fetchAvailability={fetchAvailability}
      />,
    );
    await flush();
    expect(container.querySelector('[data-seat-id="A1"]')?.hasAttribute("data-highlight")).toBe(true);
    expect(container.querySelector('[data-seat-id="A2"]')?.hasAttribute("data-highlight")).toBe(true);
    expect(fetchSeatMap).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when the selected session actually changes", async () => {
    const fetchSeatMap = vi.fn().mockResolvedValue(scoredMap());
    const fetchAvailability = vi.fn().mockResolvedValue(EMPTY_AVAILABILITY);

    const { rerender } = render(
      <OptionSeatMapPanel
        option={OPTION}
        movieKey="event:555"
        party={1}
        minScore={74}
        onClose={() => {}}
        fetchSeatMap={fetchSeatMap}
        fetchAvailability={fetchAvailability}
      />,
    );
    await flush();
    expect(fetchSeatMap).toHaveBeenCalledTimes(1);

    rerender(
      <OptionSeatMapPanel
        option={{ ...OPTION, sessionId: "evt-9002" }}
        movieKey="event:555"
        party={1}
        minScore={74}
        onClose={() => {}}
        fetchSeatMap={fetchSeatMap}
        fetchAvailability={fetchAvailability}
      />,
    );
    await flush();
    expect(fetchSeatMap).toHaveBeenCalledTimes(2);
    expect(fetchSeatMap).toHaveBeenLastCalledWith("event", "evt-9002", expect.anything());
  });
});
