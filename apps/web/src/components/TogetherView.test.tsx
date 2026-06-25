import { render, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TogetherView } from "./TogetherView";
import { getTogether } from "../api";
import type { TogetherResponse } from "../api";
import type { TogetherResult, TogetherBlock } from "../together/matrix";
import type { TogetherSession } from "../together/normalize";

// Only getTogether is controlled; DEFAULT_SCORING / fetchSeatMap / API_BASE stay real.
vi.mock("../api", async (importActual) => ({
  ...(await importActual<typeof import("../api")>()),
  getTogether: vi.fn(),
}));

const mockGetTogether = vi.mocked(getTogether);

function block(avgScore = 92): TogetherBlock {
  return { row: 0, rowLabel: "L", startCol: 0, seatIds: ["L1", "L2"], avgScore, minScore: avgScore };
}

function session(over: Partial<TogetherSession>): TogetherSession {
  return {
    id: "s1",
    chain: "event",
    movieId: "M",
    movieName: "Some Movie",
    cinemaId: "C",
    cinemaName: "Cinema",
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

/** One result for a given cinema/movie, with a block so the matrix renders the row. */
function resultFor(over: { cinemaId: string; cinemaName: string; movieId?: string; date?: string }): TogetherResult {
  const date = over.date ?? "2026-06-27";
  return {
    session: session({
      id: `${over.cinemaId}-s1`,
      cinemaId: over.cinemaId,
      cinemaName: over.cinemaName,
      movieId: over.movieId ?? "M",
      date,
      startTime: `${date}T19:30:00.000Z`,
    }),
    block: block(),
    approximateAdjacency: false,
    fetchedAt: "2026-06-25T01:04:00.000Z",
  };
}

/** A TogetherResponse carrying a single cinema's result. */
function respFor(cinema: { cinemaId: string; cinemaName: string; movieId?: string }): TogetherResponse {
  const results = [resultFor(cinema)];
  return { party: 2, minScore: 74, count: results.length, results };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup() {
  const utils = render(<TogetherView />);
  const movieInput = utils.getByPlaceholderText(/^e\.g\./i) as HTMLInputElement;
  const scanBtn = () => utils.getByRole("button", { name: /scan/i });
  const minScore = utils.getByLabelText(/min score/i) as HTMLInputElement;
  return { ...utils, movieInput, scanBtn, minScore };
}

describe("TogetherView (ST-4 SHIP review: stale-clear / scanned-snapshot / race-guard)", () => {
  beforeEach(() => {
    mockGetTogether.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("clears the stale matrix when Scan runs with an empty movie id", async () => {
    mockGetTogether.mockResolvedValueOnce(respFor({ cinemaId: "imax", cinemaName: "IMAX Sydney" }));

    const { movieInput, scanBtn, findByText, queryByText } = setup();
    fireEvent.change(movieInput, { target: { value: "19796" } });
    fireEvent.click(scanBtn());
    expect(await findByText(/IMAX Sydney/)).toBeInTheDocument();
    expect(mockGetTogether).toHaveBeenCalledTimes(1);

    // Clear the movie id and scan again -> error, and the prior matrix is gone.
    fireEvent.change(movieInput, { target: { value: "" } });
    fireEvent.click(scanBtn());

    expect(await findByText(/enter a movie id/i)).toBeInTheDocument();
    await waitFor(() => expect(queryByText(/IMAX Sydney/)).not.toBeInTheDocument());
    // No second network call: the empty-id guard short-circuits before getTogether.
    expect(mockGetTogether).toHaveBeenCalledTimes(1);
  });

  it("minScore re-query uses the scanned snapshot, not edited-but-unscanned inputs", async () => {
    mockGetTogether.mockResolvedValue(respFor({ cinemaId: "a", cinemaName: "Cinema A", movieId: "A-MOVIE" }));

    const { movieInput, scanBtn, minScore, findByText } = setup();
    fireEvent.change(movieInput, { target: { value: "A-MOVIE" } });
    fireEvent.click(scanBtn());
    expect(await findByText(/Cinema A/)).toBeInTheDocument();
    expect(mockGetTogether).toHaveBeenCalledTimes(1);

    // Edit the movie id WITHOUT scanning, then nudge minScore (fires a re-query).
    fireEvent.change(movieInput, { target: { value: "B-MOVIE" } });
    fireEvent.change(minScore, { target: { value: "80" } });

    await waitFor(() => expect(mockGetTogether).toHaveBeenCalledTimes(2));
    const lastCall = mockGetTogether.mock.calls[mockGetTogether.mock.calls.length - 1]![0];
    expect(lastCall.movieId).toBe("A-MOVIE");
    expect(lastCall.movieId).not.toBe("B-MOVIE");
    expect(lastCall.minScore).toBe(80);
  });

  it("out-of-order re-query responses: the latest wins, the older late response is ignored", async () => {
    // Initial scan resolves immediately so a snapshot exists.
    mockGetTogether.mockResolvedValueOnce(respFor({ cinemaId: "init", cinemaName: "INIT Cinema" }));

    const pending: Array<ReturnType<typeof deferred<TogetherResponse>>> = [];
    mockGetTogether.mockImplementation(() => {
      const d = deferred<TogetherResponse>();
      pending.push(d);
      return d.promise;
    });

    const { movieInput, scanBtn, minScore, findByText, queryByText } = setup();
    fireEvent.change(movieInput, { target: { value: "M" } });
    fireEvent.click(scanBtn());
    expect(await findByText(/INIT Cinema/)).toBeInTheDocument();

    // Two re-queries via minScore: R2 then R3 (both now deferred).
    fireEvent.change(minScore, { target: { value: "50" } }); // R2 -> pending[0]
    fireEvent.change(minScore, { target: { value: "60" } }); // R3 -> pending[1]
    await waitFor(() => expect(pending).toHaveLength(2));

    // Resolve the LATEST (R3) first.
    pending[1]!.resolve(respFor({ cinemaId: "latest", cinemaName: "LATEST" }));
    expect(await findByText(/LATEST/)).toBeInTheDocument();

    // Now resolve the OLDER (R2) late — it must be discarded by the reqSeq guard.
    pending[0]!.resolve(respFor({ cinemaId: "stale", cinemaName: "STALE" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(queryByText(/STALE/)).not.toBeInTheDocument();
    expect(await findByText(/LATEST/)).toBeInTheDocument();
  });
});
