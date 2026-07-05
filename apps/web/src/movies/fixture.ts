// Mock/dev-mode data source, used until the API builder's live /options and /catalog `titles`
// land (docs/47a-contract.md §6 — "Integration checklist — shared fixture"). The three
// per-chain fixtures below are copied VERBATIM from the contract's three "worked examples"
// (Request 1/2/3, party=3 case). Both builders test against these exact fixtures per the
// contract, so do not edit their values — only the shape may evolve if the contract itself
// changes. Each call to the real API returns exactly ONE chain's options (§3, §6) — never mix
// chains into a single OptionsResponse here.
import type { AvailabilityDate, AvailabilityResponse, CatalogTitle, OptionsResponse } from "./types";

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

// --- #47b GET /availability fixture (docs/47b-contract.md §8) -------------------------------
// Seed values are the contract's own worked example, reproduced verbatim: do not edit the dates or
// the special-case numbers below without re-checking §8. `today`/`horizonDate`/`maxCachedDate` and
// the four named dates (today itself, 07-15, 07-16, 07-17) are exactly the contract's checklist
// cases; every other date in range is the generic "not-cached" filler the checklist also specifies.

const AVAILABILITY_TODAY = "2026-07-14";
const AVAILABILITY_HORIZON_DATE = "2026-08-18"; // today + REFRESH_HORIZON_DAYS (35)
const AVAILABILITY_MAX_CACHED_DATE = "2026-07-30";

function parseYmd(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y ?? 0, m ?? 1, d ?? 1];
}

function leadDaysFromToday(date: string): number {
  const [ay, am, ad] = parseYmd(AVAILABILITY_TODAY);
  const [by, bm, bd] = parseYmd(date);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86_400_000);
}

function addDays(date: string, n: number): string {
  const [y, m, d] = parseYmd(date);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function buildAvailabilityDateRow(date: string): AvailabilityDate {
  const leadDays = leadDaysFromToday(date);
  if (date === AVAILABILITY_TODAY) {
    // total_seats=120, seats_available=8, no qualifying block -> soldHeldPct 93, which is
    // >= AVAILABILITY_SOLD_HELD_THRESHOLD_PCT (90) -> resolves to sold-held-now over
    // no-qualifying-block per the state-selection order (§3) -- the threshold-boundary case.
    return {
      date,
      state: "sold-held-now",
      leadDays,
      bestBlockScore: null,
      soldHeldPct: 93,
      asOf: "2026-07-14T01:00:00.000Z",
    };
  }
  if (date === "2026-07-15") {
    // Exercises the `stale` priority rule: freshest fetched_at here is far older than
    // freshnessStaleMs(), so this date reports `stale` regardless of any known block/sold-held facts.
    return {
      date,
      state: "stale",
      leadDays,
      bestBlockScore: null,
      soldHeldPct: null,
      asOf: "2026-07-10T00:00:00.000Z",
    };
  }
  if (date === "2026-07-16") {
    // Event IMAX + Village Vmax sessions; Event has a qualifying party-3 block (avgScore 91),
    // soldHeldPct 42 -> good-block. This row is the fixture's earliest/earliestLeadDays (2).
    return {
      date,
      state: "good-block",
      leadDays,
      bestBlockScore: 91,
      soldHeldPct: 42,
      asOf: "2026-07-16T00:30:00.000Z",
    };
  }
  if (date === "2026-07-17") {
    // total_seats = NULL (pre-migration row, not yet refreshed) -> soldHeldPct: null regardless of
    // block state (§4.3) -- exercises the "never fabricate a number" rule.
    return {
      date,
      state: "no-qualifying-block",
      leadDays,
      bestBlockScore: null,
      soldHeldPct: null,
      asOf: "2026-07-17T00:15:00.000Z",
    };
  }
  // Every other date: zero cached sessions. Still "not-cached" whether within or beyond
  // maxCachedDate -- the sub-case split (no-sessions vs not-yet-ingested) is copy-only, computed
  // client-side from horizonDate/maxCachedDate (§3.1), not a different value on the row itself.
  return { date, state: "not-cached", leadDays, bestBlockScore: null, soldHeldPct: null, asOf: null };
}

function buildAvailabilityDates(): AvailabilityDate[] {
  const dates: AvailabilityDate[] = [];
  for (let cur = AVAILABILITY_TODAY; cur <= AVAILABILITY_HORIZON_DATE; cur = addDays(cur, 1)) {
    dates.push(buildAvailabilityDateRow(cur));
  }
  return dates;
}

function buildAvailabilityFixture(movieKey: string): AvailabilityResponse {
  const dates = buildAvailabilityDates();
  const earliest = dates.find((d) => d.state === "good-block") ?? null;
  return {
    movieKey,
    cinemaId: null,
    party: 3,
    minScore: 74,
    horizonDate: AVAILABILITY_HORIZON_DATE,
    maxCachedDate: AVAILABILITY_MAX_CACHED_DATE,
    earliest,
    earliestLeadDays: earliest?.leadDays ?? null,
    dates,
  };
}

/** Verbatim from docs/47b-contract.md §8, keyed per chain the same way the 47a options fixtures
 *  are — one shared date-level shape (the contract's seed data isn't itself per-chain), movieKey
 *  swapped per chain so fixtureFor's chain-matching (api.ts) never mixes movieKeys across chains. */
export const EVENT_AVAILABILITY_FIXTURE: AvailabilityResponse = buildAvailabilityFixture("event:555");
export const VILLAGE_AVAILABILITY_FIXTURE: AvailabilityResponse = buildAvailabilityFixture("village:555");
export const HOYTS_AVAILABILITY_FIXTURE: AvailabilityResponse = buildAvailabilityFixture("hoyts:555");

export const AVAILABILITY_FIXTURES_BY_CHAIN: Record<string, AvailabilityResponse> = {
  event: EVENT_AVAILABILITY_FIXTURE,
  village: VILLAGE_AVAILABILITY_FIXTURE,
  hoyts: HOYTS_AVAILABILITY_FIXTURE,
};

/** Default fixture used when a movieKey's chain has no dedicated fixture above. */
export const AVAILABILITY_FIXTURE: AvailabilityResponse = EVENT_AVAILABILITY_FIXTURE;

/** Honest "no good block anywhere in the cached horizon" fixture — pairs with
 *  NO_GOOD_SEATS_OPTIONS_FIXTURE's reading:12 movieKey; exercises the header's non-earliest
 *  fallback copy (contract §6) and the date strip with no good-block cells at all. */
export const NO_GOOD_SEATS_AVAILABILITY_FIXTURE: AvailabilityResponse = {
  movieKey: "reading:12",
  cinemaId: null,
  party: 2,
  minScore: 74,
  horizonDate: AVAILABILITY_HORIZON_DATE,
  maxCachedDate: AVAILABILITY_MAX_CACHED_DATE,
  earliest: null,
  earliestLeadDays: null,
  dates: buildAvailabilityDates().map((d) => ({
    ...d,
    state: d.state === "good-block" ? "no-qualifying-block" : d.state,
    bestBlockScore: null,
  })),
};
