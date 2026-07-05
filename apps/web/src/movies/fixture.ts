// Mock/dev-mode data source, used until the API builder's live /options and /catalog `titles`
// land (docs/47a-contract.md §6 — "Integration checklist — shared fixture"). The three
// per-chain fixtures below are copied VERBATIM from the contract's three "worked examples"
// (Request 1/2/3, party=3 case). Both builders test against these exact fixtures per the
// contract, so do not edit their values — only the shape may evolve if the contract itself
// changes. Each call to the real API returns exactly ONE chain's options (§3, §6) — never mix
// chains into a single OptionsResponse here.
import type { CatalogTitle, OptionsResponse } from "./types";

/** Verbatim from docs/47a-contract.md §6 "Request 1: Event". */
export const EVENT_OPTIONS_FIXTURE: OptionsResponse = {
  movieKey: "event:555",
  movieTitle: "Dune: Part Two",
  party: 3,
  minScore: 74,
  count: 1,
  options: [
    {
      chain: "event",
      cinemaId: "12",
      cinemaName: "Event George St",
      sessionId: "evt-9001",
      startsAt: "2026-07-21T19:40:00.000Z",
      date: "2026-07-21",
      format: "IMAX",
      isLargeFormat: true,
      formatRank: 2,
      bestBlockScore: 91,
      bestBlockSize: 3,
      fitTier: "together",
      togetherCount: 3,
      geometryConfidence: "exact",
      freshness: { asOf: "2026-07-21T02:10:00.000Z", state: "fresh" },
      bookingUrl: "https://www.eventcinemas.com.au/Ticketing/checkout/evt-9001",
    },
  ],
  freshness: {
    oldestFetchedAt: "2026-07-21T02:10:00.000Z",
    newestFetchedAt: "2026-07-21T02:10:00.000Z",
    lastSuccessfulIngestAt: "2026-07-21T02:10:00.000Z",
    coverage: { event: "cached" },
  },
};

/** Verbatim from docs/47a-contract.md §6 "Request 2: Village". */
export const VILLAGE_OPTIONS_FIXTURE: OptionsResponse = {
  movieKey: "village:555",
  movieTitle: "Dune: Part Two",
  party: 3,
  minScore: 74,
  count: 1,
  options: [
    {
      chain: "village",
      cinemaId: "40",
      cinemaName: "Village Crown",
      sessionId: "vil-4410",
      startsAt: "2026-07-21T21:00:00.000Z",
      date: "2026-07-21",
      format: "Vmax",
      isLargeFormat: true,
      formatRank: 1,
      bestBlockScore: 78,
      bestBlockSize: 2,
      fitTier: "nearby",
      togetherCount: 2,
      geometryConfidence: "exact",
      freshness: { asOf: "2026-07-20T23:55:00.000Z", state: "stale" },
      bookingUrl: "https://www.villagecinemas.com.au/checkout/vil-4410",
    },
  ],
  freshness: {
    oldestFetchedAt: "2026-07-20T23:55:00.000Z",
    newestFetchedAt: "2026-07-20T23:55:00.000Z",
    lastSuccessfulIngestAt: "2026-07-21T02:10:00.000Z",
    coverage: { village: "cached" },
  },
};

/** Verbatim from docs/47a-contract.md §6 "Request 3: Hoyts". */
export const HOYTS_OPTIONS_FIXTURE: OptionsResponse = {
  movieKey: "hoyts:555",
  movieTitle: "Dune: Part Two",
  party: 3,
  minScore: 74,
  count: 1,
  options: [
    {
      chain: "hoyts",
      cinemaId: "88",
      cinemaName: "Hoyts EQ",
      sessionId: "hoy-2207",
      startsAt: "2026-07-21T20:15:00.000Z",
      date: "2026-07-21",
      format: "",
      isLargeFormat: false,
      formatRank: 0,
      bestBlockScore: null,
      bestBlockSize: null,
      fitTier: "split",
      togetherCount: 2,
      geometryConfidence: "approximate",
      freshness: { asOf: "2026-07-21T01:00:00.000Z", state: "fresh" },
      bookingUrl: "https://www.hoyts.com.au/checkout/hoy-2207",
    },
  ],
  freshness: {
    oldestFetchedAt: "2026-07-21T01:00:00.000Z",
    newestFetchedAt: "2026-07-21T01:00:00.000Z",
    lastSuccessfulIngestAt: "2026-07-21T02:10:00.000Z",
    coverage: { hoyts: "cached" },
  },
};

/** Per-chain options fixtures, keyed by chain (contract §6's three worked examples). */
export const OPTIONS_FIXTURES_BY_CHAIN: Record<string, OptionsResponse> = {
  event: EVENT_OPTIONS_FIXTURE,
  village: VILLAGE_OPTIONS_FIXTURE,
  hoyts: HOYTS_OPTIONS_FIXTURE,
};

/** Default fixture used when a movieKey's chain has no dedicated fixture above. */
export const OPTIONS_FIXTURE: OptionsResponse = EVENT_OPTIONS_FIXTURE;

/**
 * Catalog titles fixture — constructed for dev/mock use (the contract does not give a verbatim
 * `titles` example, only the shape, §2). Reuses the fixture's own movie/chain/movieKey so the
 * option-list mock resolves consistently, plus a duplicate-title row (grouping) and an unrelated
 * title (search/browse, no-good-seats honest state has nothing to do with this movie).
 */
export const CATALOG_TITLES_FIXTURE: CatalogTitle[] = [
  { movieKey: "event:555", chain: "event", title: "Dune: Part Two", sessionCount: 12 },
  { movieKey: "village:555", chain: "village", title: "Dune: Part Two", sessionCount: 4 },
  { movieKey: "hoyts:900", chain: "hoyts", title: "The Odyssey", sessionCount: 6 },
  { movieKey: "reading:12", chain: "reading", title: "No Great Seats Tonight", sessionCount: 1 },
];

/** Options fixture for the "no qualifying block anywhere" honest state — every row is `split`. */
export const NO_GOOD_SEATS_OPTIONS_FIXTURE: OptionsResponse = {
  movieKey: "reading:12",
  movieTitle: "No Great Seats Tonight",
  party: 2,
  minScore: 74,
  count: 1,
  options: [
    {
      chain: "reading",
      cinemaId: "77",
      cinemaName: "Reading Newmarket",
      sessionId: "rdg-100",
      startsAt: "2026-07-21T18:30:00.000Z",
      date: "2026-07-21",
      format: "",
      isLargeFormat: false,
      formatRank: 0,
      bestBlockScore: null,
      bestBlockSize: null,
      fitTier: "split",
      togetherCount: 1,
      geometryConfidence: "exact",
      freshness: { asOf: "2026-07-21T01:00:00.000Z", state: "fresh" },
      bookingUrl: "https://www.readingcinemas.com.au/checkout/rdg-100",
    },
  ],
  freshness: {
    oldestFetchedAt: "2026-07-21T01:00:00.000Z",
    newestFetchedAt: "2026-07-21T01:00:00.000Z",
    lastSuccessfulIngestAt: "2026-07-21T01:00:00.000Z",
    coverage: { reading: "cached" },
  },
};
