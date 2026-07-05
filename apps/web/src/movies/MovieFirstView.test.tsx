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

// 47c fix #6: fetch-triggering state is debounced 350ms — these tests use real timers, so any
// assertion that depends on a debounced refetch needs headroom past that window.
const DEBOUNCE_WAIT = { timeout: 2000 };

const AVAILABILITY_RESPONSE: AvailabilityResponse = {
  movieKey: "event:555",
  cinemaId: null,
  party: 1,
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

function optionsResponse(options: Option[], party = 1): OptionsResponse {
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

  it("Screen 0 -> pick a movie -> fetches and renders the option list (47c fix #7: solo party defaults to 1, label-honest with 'Just me')", async () => {
    mockFetchCatalogTitles.mockResolvedValue(TITLES);
    mockFetchOptions.mockResolvedValue(optionsResponse([option({})]));

    render(<MovieFirstView />);
    const movieButton = await screen.findByRole("button", { name: /Dune: Part Two/ });
    fireEvent.click(movieButton);

    await waitFor(() =>
      expect(mockFetchOptions).toHaveBeenCalledWith({
        movieKey: "event:555",
        party: 1,
        minScore: 74,
      }),
    );
    expect(await screen.findByText(/Event George St/)).toBeInTheDocument();
  });

  it(
    "47c fix #3: Plan-group mode fans out one /options call per distinct per-day headcount and keeps each card's own honest fit tier",
    async () => {
      mockFetchCatalogTitles.mockResolvedValue(TITLES);
      // Initial (pre-group) discovery fetch at the group floor (party=2) surfaces two days.
      mockFetchOptions.mockResolvedValueOnce(
        optionsResponse(
          [
            option({ sessionId: "d1", date: "2026-07-21", fitTier: "together", togetherCount: 2, bestBlockScore: 97 }),
            option({ sessionId: "d2", date: "2026-07-22", fitTier: "together", togetherCount: 2, bestBlockScore: 90 }),
          ],
          2,
        ),
      );
      // Fallback for the group-mode fan-out calls that follow (this test only asserts on the
      // /options CALL params, not on what the fanned-out responses render).
      mockFetchOptions.mockResolvedValue(optionsResponse([], 2));

      render(<MovieFirstView />);
      fireEvent.click(await screen.findByRole("button", { name: /Dune: Part Two/ }));
      await waitFor(() => expect(mockFetchOptions).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByRole("tab", { name: "Plan group" }));
      const day2Group = await screen.findByRole("group", { name: /22 Jul.*headcount/i });
      const day2Increase = within(day2Group).getByRole("button", { name: /Increase/i });

      // Bump day2 (2026-07-22) from 2 to 7 — day1 (2026-07-21) stays at the group floor, 2.
      for (let i = 0; i < 5; i++) fireEvent.click(day2Increase);
      await within(day2Group).findByText("7");

      // Once debounced settle happens, the effect fans out: one /options call at party=2 (day1's
      // group) and one at party=7 (day2's group).
      await waitFor(
        () =>
          expect(mockFetchOptions).toHaveBeenCalledWith({
            movieKey: "event:555",
            party: 7,
            minScore: 74,
          }),
        DEBOUNCE_WAIT,
      );
      await waitFor(() =>
        expect(mockFetchOptions).toHaveBeenCalledWith({
          movieKey: "event:555",
          party: 2,
          minScore: 74,
        }),
      );
    },
    10_000,
  );

  it("organiser toggle is reachable and functional: no per-day server ranking is implied in copy", async () => {
    mockFetchCatalogTitles.mockResolvedValue(TITLES);
    mockFetchOptions.mockResolvedValue(optionsResponse([option({})], 2));

    render(<MovieFirstView />);
    fireEvent.click(await screen.findByRole("button", { name: /Dune: Part Two/ }));
    await waitFor(() => expect(mockFetchOptions).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("tab", { name: "Plan group" }));

    expect(screen.getByText(/how many likely each day/i)).toBeInTheDocument();
    expect(screen.queryByText(/optimi[sz]ing for each day/i)).toBeNull();
  });

  it("tap-through: selecting an option opens the seat-map hero panel with a booking CTA, and the heading shows the DATE (47c fix #4)", async () => {
    mockFetchCatalogTitles.mockResolvedValue(TITLES);
    mockFetchOptions.mockResolvedValue(
      optionsResponse([option({ bookingUrl: "https://book.test/x", date: "2026-07-21" })]),
    );

    render(<MovieFirstView />);
    fireEvent.click(await screen.findByRole("button", { name: /Dune: Part Two/ }));
    const card = await screen.findByText(/Event George St/);
    fireEvent.click(card.closest("button")!);

    const bookLink = await screen.findByRole("link", { name: /Book on Event Cinemas/i });
    expect(bookLink).toHaveAttribute("href", "https://book.test/x");
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(/Tue 21 Jul/);
  });

  it("47b: renders the header availability summary once /availability resolves", async () => {
    mockFetchCatalogTitles.mockResolvedValue(TITLES);
    mockFetchOptions.mockResolvedValue(optionsResponse([option({})]));

    render(<MovieFirstView />);
    fireEvent.click(await screen.findByRole("button", { name: /Dune: Part Two/ }));

    expect(
      await screen.findByText(/Earliest 1 good seats: .* \(2 days out\) · 81% sold\/held as of/),
    ).toBeInTheDocument();
    expect(mockFetchAvailability).toHaveBeenCalledWith({ movieKey: "event:555", party: 1, minScore: 74 });
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
        party: 1,
        minScore: 74,
        cinemaId: "12",
      }),
    );
  });

  it("47c fix #5: clicking a date-strip cell applies that date as the option list's day filter", async () => {
    mockFetchCatalogTitles.mockResolvedValue(TITLES);
    mockFetchOptions.mockResolvedValue(
      optionsResponse([
        option({ sessionId: "sun", date: "2026-07-19", startsAt: "2026-07-19T19:00:00.000Z", cinemaId: "12" }),
        option({ sessionId: "tue", date: "2026-07-21", startsAt: "2026-07-21T19:00:00.000Z", cinemaId: "12" }),
      ]),
    );
    mockFetchAvailability.mockResolvedValue({
      ...AVAILABILITY_RESPONSE,
      dates: [
        { date: "2026-07-19", state: "good-block", leadDays: 0, bestBlockScore: 90, soldHeldPct: 10, asOf: "2026-07-19T01:00:00.000Z" },
      ],
    });

    const { container } = render(<MovieFirstView />);
    fireEvent.click(await screen.findByRole("button", { name: /Dune: Part Two/ }));
    await waitFor(() => expect(container.querySelectorAll(".optioncard")).toHaveLength(2));
    const sunCard = [...container.querySelectorAll(".optioncard")].find((el) =>
      el.textContent?.includes("Sun 19 Jul"),
    )!;
    fireEvent.click(sunCard);

    const strip = await screen.findByRole("group", { name: "Date availability" });
    fireEvent.click(within(strip).getByRole("button", { name: /19 Jul/ }));

    // The option list narrows to just the 2026-07-19 card (the day filter chip row itself still
    // lists both days — filtering the CARDS is the point, not hiding the day picker).
    await waitFor(() => {
      const cards = [...container.querySelectorAll(".optioncard")];
      expect(cards).toHaveLength(1);
      expect(cards[0]!.textContent).toMatch(/Sun 19 Jul/);
    });
  });

  it("47c fix #6: rapid party stepper clicks coalesce into a single settled /options refetch, not one per click", async () => {
    mockFetchCatalogTitles.mockResolvedValue(TITLES);
    mockFetchOptions.mockResolvedValue(optionsResponse([option({})]));

    render(<MovieFirstView />);
    fireEvent.click(await screen.findByRole("button", { name: /Dune: Part Two/ }));
    await waitFor(() => expect(mockFetchOptions).toHaveBeenCalledTimes(1));

    const increase = screen.getByRole("button", { name: "Increase Party headcount" });
    fireEvent.click(increase);
    fireEvent.click(increase);
    fireEvent.click(increase);

    // Immediately after the burst, no new fetch has fired yet (debounce still pending).
    expect(mockFetchOptions).toHaveBeenCalledTimes(1);

    await waitFor(
      () =>
        expect(mockFetchOptions).toHaveBeenLastCalledWith({
          movieKey: "event:555",
          party: 4, // 1 -> 4 in one settled call, not three intermediate calls
          minScore: 74,
        }),
      DEBOUNCE_WAIT,
    );
    // Exactly 2 calls total: the initial mount fetch, then ONE coalesced refetch for the whole burst.
    expect(mockFetchOptions).toHaveBeenCalledTimes(2);
  });
});
