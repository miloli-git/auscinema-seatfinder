import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TogetherView } from "./TogetherView";
import { fetchCatalog, getTogether } from "../api";
import type { CatalogMovie, CatalogResponse, TogetherResponse } from "../api";
import type { TogetherResult, TogetherBlock } from "../together/matrix";
import type { TogetherSession } from "../together/normalize";
import type { Chain } from "../types";

// getTogether and fetchCatalog are controlled; DEFAULT_SCORING / fetchSeatMap / API_BASE stay real.
vi.mock("../api", async (importActual) => ({
  ...(await importActual<typeof import("../api")>()),
  getTogether: vi.fn(),
  fetchCatalog: vi.fn(),
}));

const mockGetTogether = vi.mocked(getTogether);
const mockFetchCatalog = vi.mocked(fetchCatalog);

const DEFAULT_MOVIES: CatalogMovie[] = [
  { id: "19796", name: "Blue Harvest", chain: "event" },
  { id: "19797", name: "Blue Harvest", chain: "event" },
  { id: "19800", name: null, chain: "event" },
];

function catalog(movies: CatalogMovie[] = DEFAULT_MOVIES): CatalogResponse {
  return {
    movies,
    cinemas: [],
    dates: ["2026-06-27"],
  };
}

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
function resultFor(over: {
  cinemaId: string;
  cinemaName: string;
  chain?: Chain;
  movieId?: string;
  date?: string;
  avgScore?: number;
}): TogetherResult {
  const date = over.date ?? "2026-06-27";
  return {
    session: session({
      id: `${over.cinemaId}-s1`,
      chain: over.chain ?? "event",
      cinemaId: over.cinemaId,
      cinemaName: over.cinemaName,
      movieId: over.movieId ?? "M",
      date,
      startTime: `${date}T19:30:00.000Z`,
    }),
    block: block(over.avgScore),
    approximateAdjacency: false,
    fetchedAt: "2026-06-25T01:04:00.000Z",
  };
}

/** A TogetherResponse carrying a single cinema's result. */
function respFor(cinema: {
  cinemaId: string;
  cinemaName: string;
  chain?: Chain;
  movieId?: string;
  avgScore?: number;
}): TogetherResponse {
  const results = [resultFor(cinema)];
  return { party: 2, minScore: 74, count: results.length, results };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (err: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

function setup() {
  const utils = render(<TogetherView />);
  return {
    ...utils,
    chainSelect: () => utils.getByRole("combobox", { name: /chain/i }) as HTMLSelectElement,
    movieSelect: () => utils.getByRole("combobox", { name: /movie/i }) as HTMLSelectElement,
    rawMovieInput: () => utils.getByPlaceholderText(/^e\.g\./i) as HTMLInputElement,
    scanBtn: () => utils.getByRole("button", { name: /scan/i }),
    minScore: () => utils.getByLabelText(/min score/i) as HTMLInputElement,
  };
}

async function readyMovieSelect(view: ReturnType<typeof setup>) {
  await waitFor(() => {
    const select = view.getByRole("combobox", { name: /movie/i }) as HTMLSelectElement;
    expect(select).not.toBeDisabled();
    expect(within(select).getByRole("option", { name: /pick a movie/i })).toBeInTheDocument();
  });
  return view.getByRole("combobox", { name: /movie/i }) as HTMLSelectElement;
}

async function resolveDeferred<T>(d: { promise: Promise<T>; resolve: (v: T) => void }, value: T) {
  await act(async () => {
    d.resolve(value);
    await d.promise;
  });
}

describe("TogetherView movie picker acceptance", () => {
  beforeEach(() => {
    mockGetTogether.mockReset();
    mockFetchCatalog.mockReset();
    mockFetchCatalog.mockResolvedValue(catalog());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("catalog picker", () => {
    it("req 1: catalog ready renders a blank movie select and the mocked movie labels", async () => {
      const view = setup();
      const select = await readyMovieSelect(view);

      expect(mockFetchCatalog).toHaveBeenCalledWith("event");
      expect(select.value).toBe("");
      expect(within(select).getByRole("option", { name: /pick a movie/i })).toHaveValue("");
      expect(within(select).getByRole("option", { name: "Blue Harvest (19796)" })).toHaveValue("19796");
      expect(within(select).getByRole("option", { name: "Blue Harvest (19797)" })).toHaveValue("19797");
      expect(within(select).getByRole("option", { name: "19800" })).toHaveValue("19800");
    });

    it("req 2: selecting a catalog movie and scanning calls getTogether with the selected id", async () => {
      mockGetTogether.mockResolvedValueOnce(respFor({ cinemaId: "imax", cinemaName: "IMAX Sydney", movieId: "19797" }));

      const view = setup();
      const select = await readyMovieSelect(view);
      fireEvent.change(select, { target: { value: "19797" } });
      fireEvent.click(view.scanBtn());

      await waitFor(() => expect(mockGetTogether).toHaveBeenCalledTimes(1));
      expect(mockGetTogether).toHaveBeenLastCalledWith({
        chain: "event",
        movieId: "19797",
        party: 2,
        minScore: 74,
      });
      expect(await view.findByText(/IMAX Sydney/)).toBeInTheDocument();
    });

    it("req 3: catalog error degrades to raw id input, and the catalog failure is not a Scan failed banner", async () => {
      mockFetchCatalog.mockRejectedValueOnce(new Error("503: no DB pool"));
      mockGetTogether.mockResolvedValueOnce(respFor({ cinemaId: "raw", cinemaName: "Raw Input Cinema", movieId: "RAW-42" }));

      const view = setup();
      const input = (await view.findByPlaceholderText(/^e\.g\./i)) as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(view.queryByText(/scan failed/i)).not.toBeInTheDocument();

      fireEvent.change(input, { target: { value: "RAW-42" } });
      fireEvent.click(view.scanBtn());

      await waitFor(() => expect(mockGetTogether).toHaveBeenCalledTimes(1));
      expect(mockGetTogether.mock.calls[0]![0].movieId).toBe("RAW-42");
      expect(await view.findByText(/Raw Input Cinema/)).toBeInTheDocument();
      expect(view.queryByText(/scan failed/i)).not.toBeInTheDocument();
    });

    it("req 4: chain switch refetches, clears selected movie, clears matrix, and clears the scanned snapshot", async () => {
      mockGetTogether.mockResolvedValue(respFor({ cinemaId: "event-c", cinemaName: "Event Matrix Cinema", movieId: "19796" }));

      const view = setup();
      const select = await readyMovieSelect(view);
      fireEvent.change(select, { target: { value: "19796" } });
      fireEvent.click(view.scanBtn());
      expect(await view.findByText(/Event Matrix Cinema/)).toBeInTheDocument();
      expect(mockGetTogether).toHaveBeenCalledTimes(1);

      fireEvent.change(view.chainSelect(), { target: { value: "hoyts" } });

      await waitFor(() => expect(mockFetchCatalog).toHaveBeenCalledWith("hoyts"));
      const resetSelect = await readyMovieSelect(view);
      expect(resetSelect.value).toBe("");
      expect(view.queryByText(/Event Matrix Cinema/)).not.toBeInTheDocument();

      fireEvent.change(view.minScore(), { target: { value: "80" } });
      await Promise.resolve();
      expect(mockGetTogether).toHaveBeenCalledTimes(1);
    });

    it("req 5: chain switch invalidates an in-flight together scan so the late old-chain response does not render", async () => {
      const pending = deferred<TogetherResponse>();
      mockGetTogether.mockReturnValueOnce(pending.promise);

      const view = setup();
      const select = await readyMovieSelect(view);
      fireEvent.change(select, { target: { value: "19796" } });
      fireEvent.click(view.scanBtn());
      await waitFor(() => expect(mockGetTogether).toHaveBeenCalledTimes(1));

      fireEvent.change(view.chainSelect(), { target: { value: "hoyts" } });
      await waitFor(() => expect(mockFetchCatalog).toHaveBeenCalledWith("hoyts"));
      expect((await readyMovieSelect(view)).value).toBe("");

      await resolveDeferred(pending, respFor({ cinemaId: "old", cinemaName: "Old Event Cinema", movieId: "19796" }));
      expect(view.queryByText(/Old Event Cinema/)).not.toBeInTheDocument();
    });

    it("req 6: catalog race keeps the new chain catalog when the old chain resolves late", async () => {
      const eventCatalog = deferred<CatalogResponse>();
      const hoytsCatalog = deferred<CatalogResponse>();
      mockFetchCatalog.mockImplementation((chain?: string) => {
        if (chain === "event") return eventCatalog.promise;
        if (chain === "hoyts") return hoytsCatalog.promise;
        return Promise.resolve(catalog());
      });

      const view = setup();
      fireEvent.change(view.chainSelect(), { target: { value: "hoyts" } });
      await waitFor(() => expect(mockFetchCatalog).toHaveBeenCalledWith("hoyts"));

      await resolveDeferred(
        hoytsCatalog,
        catalog([{ id: "H-1", name: "Hoyts New Chain Movie", chain: "hoyts" }]),
      );
      const select = await readyMovieSelect(view);
      expect(within(select).getByRole("option", { name: "Hoyts New Chain Movie" })).toHaveValue("H-1");

      await resolveDeferred(
        eventCatalog,
        catalog([{ id: "E-STALE", name: "Stale Event Movie", chain: "event" }]),
      );
      const currentSelect = view.movieSelect();
      expect(within(currentSelect).getByRole("option", { name: "Hoyts New Chain Movie" })).toHaveValue("H-1");
      expect(within(currentSelect).queryByRole("option", { name: "Stale Event Movie" })).not.toBeInTheDocument();
    });

    it("req 7: blank initial select does not auto-select movie zero or call getTogether", async () => {
      const view = setup();
      const select = await readyMovieSelect(view);

      expect(select.value).toBe("");
      fireEvent.click(view.scanBtn());

      expect(mockGetTogether).not.toHaveBeenCalled();
      expect(select.value).toBe("");
      expect(await view.findByText(/enter a movie id/i)).toBeInTheDocument();
    });

    it("req 8: null-name movie uses its id as the option label and scans with that id", async () => {
      mockGetTogether.mockResolvedValueOnce(respFor({ cinemaId: "null-name", cinemaName: "Null Name Cinema", movieId: "19800" }));

      const view = setup();
      const select = await readyMovieSelect(view);
      expect(within(select).getByRole("option", { name: "19800" })).toHaveValue("19800");

      fireEvent.change(select, { target: { value: "19800" } });
      fireEvent.click(view.scanBtn());

      await waitFor(() => expect(mockGetTogether).toHaveBeenCalledTimes(1));
      expect(mockGetTogether.mock.calls[0]![0].movieId).toBe("19800");
      expect(await view.findByText(/Null Name Cinema/)).toBeInTheDocument();
    });

    it("req 9: empty catalog shows the no-movies state and does not fall back to raw input", async () => {
      mockFetchCatalog.mockResolvedValueOnce(catalog([]));

      const view = setup();
      await waitFor(() => {
        const select = view.getByRole("combobox", { name: /movie/i }) as HTMLSelectElement;
        expect(within(select).getByRole("option", { name: /no movies cached/i })).toBeInTheDocument();
      });
      const select = view.movieSelect();

      expect(view.queryByPlaceholderText(/^e\.g\./i)).not.toBeInTheDocument();
      expect(select.value).toBe("");
      expect(within(select).getAllByRole("option")).toHaveLength(1);
    });
  });

  describe("ported TogetherView invariants", () => {
    it("req 10: empty-id Scan clears the stale matrix and makes no getTogether call", async () => {
      mockGetTogether.mockResolvedValueOnce(respFor({ cinemaId: "imax", cinemaName: "IMAX Sydney", movieId: "19796" }));

      const view = setup();
      const select = await readyMovieSelect(view);
      fireEvent.change(select, { target: { value: "19796" } });
      fireEvent.click(view.scanBtn());
      expect(await view.findByText(/IMAX Sydney/)).toBeInTheDocument();
      expect(mockGetTogether).toHaveBeenCalledTimes(1);

      fireEvent.change(select, { target: { value: "" } });
      fireEvent.click(view.scanBtn());

      expect(await view.findByText(/enter a movie id/i)).toBeInTheDocument();
      await waitFor(() => expect(view.queryByText(/IMAX Sydney/)).not.toBeInTheDocument());
      expect(mockGetTogether).toHaveBeenCalledTimes(1);
    });

    it("req 11: minScore re-query uses the scanned snapshot, not edited-but-unscanned selection", async () => {
      mockGetTogether.mockResolvedValue(respFor({ cinemaId: "a", cinemaName: "Cinema A", movieId: "19796" }));

      const view = setup();
      const select = await readyMovieSelect(view);
      fireEvent.change(select, { target: { value: "19796" } });
      fireEvent.click(view.scanBtn());
      expect(await view.findByText(/Cinema A/)).toBeInTheDocument();
      expect(mockGetTogether).toHaveBeenCalledTimes(1);

      fireEvent.change(select, { target: { value: "19797" } });
      fireEvent.change(view.minScore(), { target: { value: "80" } });

      await waitFor(() => expect(mockGetTogether).toHaveBeenCalledTimes(2));
      const lastCall = mockGetTogether.mock.calls[mockGetTogether.mock.calls.length - 1]![0];
      expect(lastCall.movieId).toBe("19796");
      expect(lastCall.movieId).not.toBe("19797");
      expect(lastCall.minScore).toBe(80);
    });

    it("req 12: out-of-order re-query responses render the latest and ignore the older late response", async () => {
      mockGetTogether.mockImplementationOnce(() =>
        Promise.resolve(respFor({ cinemaId: "init", cinemaName: "INIT Cinema", movieId: "19796" })),
      );
      const pending: Array<ReturnType<typeof deferred<TogetherResponse>>> = [];
      mockGetTogether.mockImplementation(() => {
        const d = deferred<TogetherResponse>();
        pending.push(d);
        return d.promise;
      });

      const view = setup();
      const select = await readyMovieSelect(view);
      fireEvent.change(select, { target: { value: "19796" } });
      fireEvent.click(view.scanBtn());
      expect(await view.findByText(/INIT Cinema/)).toBeInTheDocument();

      fireEvent.change(view.minScore(), { target: { value: "50" } });
      fireEvent.change(view.minScore(), { target: { value: "60" } });
      await waitFor(() => expect(pending).toHaveLength(2));

      await resolveDeferred(pending[1]!, respFor({ cinemaId: "latest", cinemaName: "LATEST", movieId: "19796" }));
      expect(await view.findByText(/LATEST/)).toBeInTheDocument();

      await resolveDeferred(pending[0]!, respFor({ cinemaId: "stale", cinemaName: "STALE", movieId: "19796" }));
      expect(view.queryByText(/STALE/)).not.toBeInTheDocument();
      expect(await view.findByText(/LATEST/)).toBeInTheDocument();
    });
  });
});
