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

  it(
    "PR #80 review / BLOCKER-3 end-to-end: 6 Tue + 7 Wed with differing fit outcomes RENDERS each day's own honest card text (not just the right fetch params)",
    async () => {
      mockFetchCatalogTitles.mockResolvedValue(TITLES);
      // The server has no notion of per-day party: every /options response returns ALL THREE
      // sessions, with fit facts computed at the REQUESTED party. The client's fan-out+merge must
      // keep, per day, only the response fetched at that day's own headcount.
      const allSessionsAtParty = (party: number): Option[] => {
        if (party >= 7) {
          // At 7, nothing fits together anywhere — split, 4 seats, no qualifying block.
          return [
            option({ sessionId: "sun", date: "2026-07-19", startsAt: "2026-07-19T19:00:00.000Z", fitTier: "split", togetherCount: 4, bestBlockScore: null, bestBlockSize: null }),
            option({ sessionId: "tue", date: "2026-07-21", startsAt: "2026-07-21T19:00:00.000Z", fitTier: "split", togetherCount: 4, bestBlockScore: null, bestBlockSize: null }),
            option({ sessionId: "wed", date: "2026-07-22", startsAt: "2026-07-22T19:00:00.000Z", fitTier: "split", togetherCount: 4, bestBlockScore: null, bestBlockSize: null }),
          ];
        }
        if (party >= 6) {
          return [
            option({ sessionId: "sun", date: "2026-07-19", startsAt: "2026-07-19T19:00:00.000Z", fitTier: "together", togetherCount: 6, bestBlockScore: 88 }),
            option({ sessionId: "tue", date: "2026-07-21", startsAt: "2026-07-21T19:00:00.000Z", fitTier: "together", togetherCount: 6, bestBlockScore: 88 }),
            option({ sessionId: "wed", date: "2026-07-22", startsAt: "2026-07-22T19:00:00.000Z", fitTier: "together", togetherCount: 6, bestBlockScore: 88 }),
          ];
        }
        return [
          option({ sessionId: "sun", date: "2026-07-19", startsAt: "2026-07-19T19:00:00.000Z", fitTier: "together", togetherCount: Math.max(party, 1), bestBlockScore: 97 }),
          option({ sessionId: "tue", date: "2026-07-21", startsAt: "2026-07-21T19:00:00.000Z", fitTier: "together", togetherCount: Math.max(party, 1), bestBlockScore: 97 }),
          option({ sessionId: "wed", date: "2026-07-22", startsAt: "2026-07-22T19:00:00.000Z", fitTier: "together", togetherCount: Math.max(party, 1), bestBlockScore: 97 }),
        ];
      };
      mockFetchOptions.mockImplementation((q) =>
        Promise.resolve(optionsResponse(allSessionsAtParty(q.party ?? 2), q.party ?? 2)),
      );

      const { container } = render(<MovieFirstView />);
      fireEvent.click(await screen.findByRole("button", { name: /Dune: Part Two/ }));
      await waitFor(() => expect(container.querySelectorAll(".optioncard").length).toBe(3));

      fireEvent.click(screen.getByRole("tab", { name: "Plan group" }));
      const tueGroup = await screen.findByRole("group", { name: /21 Jul.*headcount/i });
      const wedGroup = await screen.findByRole("group", { name: /22 Jul.*headcount/i });

      // Tue -> 6, Wed -> 7. Sunday stays at the group floor (2), untouched by the user.
      const tueUp = within(tueGroup).getByRole("button", { name: /Increase/i });
      const wedUp = within(wedGroup).getByRole("button", { name: /Increase/i });
      for (let i = 0; i < 4; i++) fireEvent.click(tueUp);
      await within(tueGroup).findByText("6");
      for (let i = 0; i < 5; i++) fireEvent.click(wedUp);
      await within(wedGroup).findByText("7");

      // After the debounced fan-out settles, each day's card renders ITS OWN day's fit facts:
      // this is the rendered-text assertion the original test lacked — the false version of this
      // UI stamped "All 7 together" (or the max-party fit) on every card including Sunday's.
      await waitFor(() => {
        const cards = [...container.querySelectorAll(".optioncard")].map((el) => el.textContent ?? "");
        expect(cards).toHaveLength(3);
        const sunCard = cards.find((t) => t.includes("Sun 19 Jul"))!;
        const tueCard = cards.find((t) => t.includes("Tue 21 Jul"))!;
        const wedCard = cards.find((t) => t.includes("Wed 22 Jul"))!;
        expect(sunCard).toContain("All 2 together"); // party=2 fetch's own view, NOT "All 7 together"
        expect(tueCard).toContain("All 6 together"); // Tue's own headcount, 6
        expect(wedCard).toContain("4 of 7 seats (not adjacent)"); // Wed at 7: honest split copy
      }, DEBOUNCE_WAIT);
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

  it(
    "47c-followup (issue #81): group-mode header fans out /availability per distinct headcount and merges honestly — the day left at the group floor is no longer stamped with the OTHER day's headcount's verdict",
    async () => {
      mockFetchCatalogTitles.mockResolvedValue(TITLES);
      // Two known days at the group floor (2) to start.
      mockFetchOptions.mockResolvedValueOnce(
        optionsResponse(
          [
            option({ sessionId: "d1", date: "2026-07-21" }),
            option({ sessionId: "d2", date: "2026-07-22" }),
          ],
          2,
        ),
      );
      mockFetchOptions.mockResolvedValue(optionsResponse([], 2));

      // Per-party /availability fixtures: at party=7 (the pre-fix global-max), BOTH days read
      // good-block — 07-21 was never bumped past 2, so this is the false claim. At party=2 (07-21's
      // OWN headcount), 07-21 is honestly no-qualifying-block.
      mockFetchAvailability.mockImplementation((q) => {
        if (q.party === 2) {
          return Promise.resolve({
            ...AVAILABILITY_RESPONSE,
            party: 2,
            earliest: null,
            earliestLeadDays: null,
            dates: [{ date: "2026-07-21", state: "no-qualifying-block", leadDays: 0, bestBlockScore: null, soldHeldPct: null, asOf: null }],
          });
        }
        // party === 7 (baseline + the 07-22 group)
        return Promise.resolve({
          ...AVAILABILITY_RESPONSE,
          party: 7,
          earliest: { date: "2026-07-21", state: "good-block", leadDays: 0, bestBlockScore: 95, soldHeldPct: null, asOf: null },
          earliestLeadDays: 0,
          dates: [
            { date: "2026-07-21", state: "good-block", leadDays: 0, bestBlockScore: 95, soldHeldPct: null, asOf: null },
            { date: "2026-07-22", state: "good-block", leadDays: 1, bestBlockScore: 90, soldHeldPct: null, asOf: null },
          ],
        });
      });

      render(<MovieFirstView />);
      fireEvent.click(await screen.findByRole("button", { name: /Dune: Part Two/ }));
      await waitFor(() => expect(mockFetchOptions).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByRole("tab", { name: "Plan group" }));
      const day2Group = await screen.findByRole("group", { name: /22 Jul.*headcount/i });
      const day2Increase = within(day2Group).getByRole("button", { name: /Increase/i });
      // Bump 07-22 from 2 to 7 — 07-21 stays at the group floor, 2.
      for (let i = 0; i < 5; i++) fireEvent.click(day2Increase);
      await within(day2Group).findByText("7");

      // Fan-out: one baseline call at the fallback (max) party, plus one call per distinct
      // headcount (2 and 7).
      await waitFor(
        () => expect(mockFetchAvailability).toHaveBeenCalledWith({ movieKey: "event:555", party: 2, minScore: 74 }),
        DEBOUNCE_WAIT,
      );
      await waitFor(() => expect(mockFetchAvailability).toHaveBeenCalledWith({ movieKey: "event:555", party: 7, minScore: 74 }));

      // The merged header must show 07-22 (Wed, 7 people) as earliest, NOT 07-21 (Tue) — 07-21's
      // own (party=2) fetch says no-qualifying-block, so the party=7 baseline's false claim about it
      // must be overridden, and the copy must name 07-22's own headcount (7), not res.party.
      const header = await screen.findByText(
        /Earliest good seats for your group: Wed 22 Jul \(7 people, 1 day out\)/,
      );
      expect(header).toBeInTheDocument();
      // The 07-21 (Tue) day stepper label is legitimately still on screen (day picker chip) — what
      // must NOT appear is the pre-fix false claim naming Tue as the earliest-good-seats day.
      expect(header.textContent).not.toMatch(/Tue 21 Jul/);
    },
    10_000,
  );

  it(
    "47c-followup: rapid per-day headcount clicks coalesce into a single settled /availability fan-out, not one per click",
    async () => {
      mockFetchCatalogTitles.mockResolvedValue(TITLES);
      mockFetchOptions.mockResolvedValueOnce(optionsResponse([option({ sessionId: "d1", date: "2026-07-21" })], 2));
      mockFetchOptions.mockResolvedValue(optionsResponse([], 2));

      render(<MovieFirstView />);
      fireEvent.click(await screen.findByRole("button", { name: /Dune: Part Two/ }));
      await waitFor(() => expect(mockFetchOptions).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByRole("tab", { name: "Plan group" }));
      // Let the group-mode switch itself settle (single headcount, party=2) before the burst, so
      // the burst's own coalescing is isolated from the mode-switch's own single fetch.
      await waitFor(() => expect(mockFetchAvailability).toHaveBeenCalledWith({ movieKey: "event:555", party: 2, minScore: 74 }));
      const callsAfterModeSwitch = mockFetchAvailability.mock.calls.length;

      const day1Group = await screen.findByRole("group", { name: /21 Jul.*headcount/i });
      const increase = within(day1Group).getByRole("button", { name: /Increase/i });
      // Rapid burst of clicks — debounce should coalesce this into one settled value (7), firing
      // exactly one further /availability fetch, not five.
      for (let i = 0; i < 5; i++) fireEvent.click(increase);
      await within(day1Group).findByText("7");

      await waitFor(
        () => expect(mockFetchAvailability).toHaveBeenCalledWith({ movieKey: "event:555", party: 7, minScore: 74 }),
        DEBOUNCE_WAIT,
      );
      // Exactly one additional fetch beyond the mode-switch's own settle (single headcount ->
      // single-call path, not a fan-out per click).
      expect(mockFetchAvailability.mock.calls.length).toBe(callsAfterModeSwitch + 1);
    },
    10_000,
  );

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
