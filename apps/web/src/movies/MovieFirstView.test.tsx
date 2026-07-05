import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MovieFirstView } from "./MovieFirstView";
import { fetchAvailability, fetchCatalogTitles, fetchOptions } from "./api";
import type { AvailabilityResponse, CatalogTitle, Option, OptionsResponse } from "./types";

vi.mock("./api", () => ({
  fetchCatalogTitles: vi.fn(),
  fetchOptions: vi.fn(),
  fetchAvailability: vi.fn(),
}));

// The tap-through seat map hits the real (unmocked) fetchSeatMap in ../api, which would attempt a
// real network call in jsdom. Mock it so OptionSeatMapPanel resolves deterministically.
vi.mock("../api", async (importActual) => ({
  ...(await importActual<typeof import("../api")>()),
  fetchSeatMap: vi.fn().mockResolvedValue({
    chain: "event",
    sessionId: "evt-9001",
    areas: [],
    seats: [],
    geometryConfidence: "exact",
    scored: [],
  }),
}));

const mockFetchCatalogTitles = vi.mocked(fetchCatalogTitles);
const mockFetchOptions = vi.mocked(fetchOptions);
const mockFetchAvailability = vi.mocked(fetchAvailability);

const AVAILABILITY_RESPONSE: AvailabilityResponse = {
  movieKey: "event:555",
  cinemaId: null,
  party: 2,
  minScore: 74,
  horizonDate: "2026-08-25",
  maxCachedDate: "2026-08-05",
  earliest: {
    date: "2026-07-23",
    state: "good-block",
    leadDays: 2,
    bestBlockScore: 91,
    soldHeldPct: 81,
    asOf: "2026-07-21T00:00:00.000Z",
  },
  earliestLeadDays: 2,
  dates: [
    {
      date: "2026-07-23",
      state: "good-block",
      leadDays: 2,
      bestBlockScore: 91,
      soldHeldPct: 81,
      asOf: "2026-07-21T00:00:00.000Z",
    },
  ],
};

const TITLES: CatalogTitle[] = [
  { movieKey: "event:555", chain: "event", title: "Dune: Part Two", sessionCount: 12 },
];

function option(overrides: Partial<Option>): Option {
  return {
    chain: "event",
    cinemaId: "1",
    cinemaName: "Event George St",
    sessionId: overrides.sessionId ?? "s1",
    startsAt: "2026-07-21T19:00:00.000Z",
    date: "2026-07-21",
    format: "IMAX",
    isLargeFormat: true,
    formatRank: 2,
    bestBlockScore: 91,
    bestBlockSize: 2,
    fitTier: "together",
    togetherCount: 2,
    geometryConfidence: "exact",
    freshness: { asOf: "2026-07-21T01:00:00.000Z", state: "fresh" },
    bookingUrl: "https://example.test/book",
    ...overrides,
  };
}

function optionsResponse(options: Option[], party = 2): OptionsResponse {
  return {
    movieKey: "event:555",
    movieTitle: "Dune: Part Two",
    party,
    minScore: 74,
    count: options.length,
    options,
    freshness: {
      oldestFetchedAt: "2026-07-21T01:00:00.000Z",
      newestFetchedAt: "2026-07-21T01:00:00.000Z",
      lastSuccessfulIngestAt: "2026-07-21T01:00:00.000Z",
      coverage: { event: "cached" },
    },
  };
}

describe("MovieFirstView", () => {
  beforeEach(() => {
    mockFetchCatalogTitles.mockReset();
    mockFetchOptions.mockReset();
    mockFetchAvailability.mockReset();
    mockFetchAvailability.mockResolvedValue(AVAILABILITY_RESPONSE);
  });

  it("Screen 0 -> pick a movie -> fetches and renders the option list", async () => {
    mockFetchCatalogTitles.mockResolvedValue(TITLES);
    mockFetchOptions.mockResolvedValue(optionsResponse([option({})]));

    render(<MovieFirstView />);
    const movieButton = await screen.findByRole("button", { name: /Dune: Part Two/ });
    fireEvent.click(movieButton);

    await waitFor(() => expect(mockFetchOptions).toHaveBeenCalledWith({
      movieKey: "event:555",
      party: 2,
      minScore: 74,
    }));
    expect(await screen.findByText(/Event George St/)).toBeInTheDocument();
  });

  it("Plan-group mode + steppers: derives party as the max of per-day counts and refetches", async () => {
    mockFetchCatalogTitles.mockResolvedValue(TITLES);
    mockFetchOptions.mockResolvedValue(
      optionsResponse([
        option({ sessionId: "d1", date: "2026-07-21" }),
        option({ sessionId: "d2", date: "2026-07-22" }),
      ]),
    );

    render(<MovieFirstView />);
    fireEvent.click(await screen.findByRole("button", { name: /Dune: Part Two/ }));
    await waitFor(() => expect(mockFetchOptions).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("tab", { name: "Plan group" }));
    const day2Group = await screen.findByRole("group", { name: /22 Jul.*headcount/i });
    const day2Increase = within(day2Group).getByRole("button", { name: /Increase/i });

    fireEvent.click(day2Increase); // day2: 2 -> 3
    await within(day2Group).findByText("3"); // let the render (and its effect) land before clicking again
    fireEvent.click(day2Increase); // day2: 3 -> 4, now the binding max
    await within(day2Group).findByText("4");

    await waitFor(() =>
      expect(mockFetchOptions).toHaveBeenLastCalledWith({
        movieKey: "event:555",
        party: 4,
        minScore: 74,
      }),
    );
  });

  it("organiser toggle is reachable and functional: no per-day server ranking is implied in copy", async () => {
    mockFetchCatalogTitles.mockResolvedValue(TITLES);
    mockFetchOptions.mockResolvedValue(optionsResponse([option({})]));

    render(<MovieFirstView />);
    fireEvent.click(await screen.findByRole("button", { name: /Dune: Part Two/ }));
    await waitFor(() => expect(mockFetchOptions).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("tab", { name: "Plan group" }));

    expect(screen.getByText(/how many likely each day/i)).toBeInTheDocument();
    expect(screen.queryByText(/optimi[sz]ing for each day/i)).toBeNull();
  });

  it("tap-through: selecting an option opens the seat-map hero panel with a booking CTA", async () => {
    mockFetchCatalogTitles.mockResolvedValue(TITLES);
    mockFetchOptions.mockResolvedValue(optionsResponse([option({ bookingUrl: "https://book.test/x" })]));

    render(<MovieFirstView />);
    fireEvent.click(await screen.findByRole("button", { name: /Dune: Part Two/ }));
    const card = await screen.findByText(/Event George St/);
    fireEvent.click(card.closest("button")!);

    const bookLink = await screen.findByRole("link", { name: /Book on Event Cinemas/i });
    expect(bookLink).toHaveAttribute("href", "https://book.test/x");
  });

  it("47b: renders the header availability summary once /availability resolves", async () => {
    mockFetchCatalogTitles.mockResolvedValue(TITLES);
    mockFetchOptions.mockResolvedValue(optionsResponse([option({})]));

    render(<MovieFirstView />);
    fireEvent.click(await screen.findByRole("button", { name: /Dune: Part Two/ }));

    expect(
      await screen.findByText(/Earliest 2 good seats: .* \(2 days out\) · 81% sold\/held as of/),
    ).toBeInTheDocument();
    expect(mockFetchAvailability).toHaveBeenCalledWith({ movieKey: "event:555", party: 2, minScore: 74 });
  });

  it("47b: tap-through renders the date-availability strip scoped to the option's cinema", async () => {
    mockFetchCatalogTitles.mockResolvedValue(TITLES);
    mockFetchOptions.mockResolvedValue(optionsResponse([option({ cinemaId: "12" })]));

    render(<MovieFirstView />);
    fireEvent.click(await screen.findByRole("button", { name: /Dune: Part Two/ }));
    const card = await screen.findByText(/Event George St/);
    fireEvent.click(card.closest("button")!);

    expect(await screen.findByRole("group", { name: "Date availability" })).toBeInTheDocument();
    await waitFor(() =>
      expect(mockFetchAvailability).toHaveBeenCalledWith({
        movieKey: "event:555",
        party: 2,
        minScore: 74,
        cinemaId: "12",
      }),
    );
  });
});
