// ST-4 Layer 4 — THE FIXTURE IS THE DEFINITION OF DONE.
//
// This is the deterministic dataset the Playwright E2E acceptance test drives the
// app against (route-mocked at the browser; NOT a real pg). Review THIS file to
// decide whether a green L4 run actually proves the feature.
//
// Designed cells (2 cinemas × 3 contiguous dates, 2026-06-27 .. 2026-06-29):
//
//                  2026-06-27        2026-06-28        2026-06-29
//   IMAX Sydney    SCORE (avg 96) ◀  —  (no session)  SCORE (avg 80)
//   (cinema "A")   GREAT BLOCK       empty gap         (Standard, 2pm)
//
//   Event George   SOLD (2 sessions  SCORE (avg 88)    —  (no session)
//   St (cinema "B") both block:null)  (IMAX, evening)   empty gap
//
//   ⇒ great-block cell = A / 2026-06-27 (avgScore 96, evening IMAX) — drilled in L4.5
//   ⇒ sold cell        = B / 2026-06-27 (sessions present, every block null = #39)
//   ⇒ empty gap        = A / 2026-06-28 (no session for that cinema/date)
//
// The matrix date axis is contiguous min..max of observed dates, so 2026-06-28
// appears as a column even though cinema A has no session that day → renders "—".

export interface FixtureBlock {
  row: number;
  rowLabel: string;
  startCol: number;
  seatIds: string[];
  avgScore: number;
  minScore: number;
}

export interface FixtureResult {
  session: {
    id: string;
    chain: string;
    movieId: string;
    movieName: string;
    cinemaId: string;
    cinemaName: string;
    date: string;
    startTime: string;
    format: string | null;
    screen: string | null;
    seatsAvailable: number;
    bookingUrl: string;
    seatAllocation: boolean;
  };
  block: FixtureBlock | null;
  approximateAdjacency: boolean;
  fetchedAt: string;
}

const CIN_A = { id: "A", name: "IMAX Sydney" };
const CIN_B = { id: "B", name: "Event George St" };
const MOVIE = { id: "19796", name: "Supergirl" };
const FETCHED_AT = "2026-06-25T01:04:22.774Z";

function mkSession(
  over: Partial<FixtureResult["session"]> & { id: string; cinemaId: string; cinemaName: string; startTime: string },
): FixtureResult["session"] {
  return {
    chain: "event",
    movieId: MOVIE.id,
    movieName: MOVIE.name,
    date: over.startTime.slice(0, 10),
    format: "Standard",
    screen: null,
    seatsAvailable: 120,
    bookingUrl: `https://example.test/book/${over.id}`,
    seatAllocation: true,
    ...over,
  };
}

function mkBlock(seatIds: string[], avgScore: number): FixtureBlock {
  return { row: -7, rowLabel: "L", startCol: -18, seatIds, avgScore, minScore: avgScore };
}

/** Seat ids of the great block (A / 27 Jun). The /seatmap fixture must keep these
 *  available for the L4.5 highlight assertion. */
export const GREAT_BLOCK_SEAT_IDS = ["L7", "L8"];

/**
 * The base designed dataset (party = 2). This is what reviewers inspect as the
 * correctness definition. The route handler derives the wire response from this
 * by nulling any block whose avgScore < the requested minScore (faithful to #39:
 * raising minScore drops weaker adjacency blocks → those cells become `sold`).
 */
export const BASE_RESULTS: FixtureResult[] = [
  // A / 27 Jun — GREAT BLOCK CELL (evening IMAX, avg 96)
  {
    session: mkSession({
      id: "A-27-imax",
      cinemaId: CIN_A.id,
      cinemaName: CIN_A.name,
      startTime: "2026-06-27T19:30:00.000Z",
      format: "IMAX",
      seatsAvailable: 322,
    }),
    block: mkBlock(GREAT_BLOCK_SEAT_IDS, 96),
    approximateAdjacency: false,
    fetchedAt: FETCHED_AT,
  },
  // A / 29 Jun — score cell (afternoon Standard, avg 80) — drops out under Evenings + IMAX filters
  {
    session: mkSession({
      id: "A-29-std",
      cinemaId: CIN_A.id,
      cinemaName: CIN_A.name,
      startTime: "2026-06-29T14:00:00.000Z",
      format: "Standard",
    }),
    block: mkBlock(["P3", "P4"], 80),
    approximateAdjacency: false,
    fetchedAt: FETCHED_AT,
  },
  // B / 27 Jun — SOLD CELL (two sessions, every block null = #39 matched-but-sold)
  {
    session: mkSession({
      id: "B-27-std-1",
      cinemaId: CIN_B.id,
      cinemaName: CIN_B.name,
      startTime: "2026-06-27T18:15:00.000Z",
      format: "Standard",
    }),
    block: null,
    approximateAdjacency: false,
    fetchedAt: FETCHED_AT,
  },
  {
    session: mkSession({
      id: "B-27-std-2",
      cinemaId: CIN_B.id,
      cinemaName: CIN_B.name,
      startTime: "2026-06-27T20:45:00.000Z",
      format: "Standard",
    }),
    block: null,
    approximateAdjacency: false,
    fetchedAt: FETCHED_AT,
  },
  // B / 28 Jun — score cell (evening IMAX, avg 88) — survives Evenings + IMAX filters
  {
    session: mkSession({
      id: "B-28-imax",
      cinemaId: CIN_B.id,
      cinemaName: CIN_B.name,
      startTime: "2026-06-28T19:00:00.000Z",
      format: "IMAX",
    }),
    block: mkBlock(["L7", "L8"], 88),
    approximateAdjacency: false,
    fetchedAt: FETCHED_AT,
  },
];

/** GET /catalog wire response — the movie-picker source. Must contain the fixture movie
 *  so the picker can select it by name and drive the same scan the old free-text id did. */
export function catalogResponse() {
  return {
    movies: [{ id: MOVIE.id, name: MOVIE.name, chain: "event" }],
    cinemas: [
      { id: CIN_A.id, name: CIN_A.name, chain: "event" },
      { id: CIN_B.id, name: CIN_B.name, chain: "event" },
    ],
    dates: ["2026-06-27", "2026-06-28", "2026-06-29"],
  };
}

export interface TogetherResponseShape {
  party: number;
  minScore: number;
  count: number;
  results: FixtureResult[];
}

/** Build the /together wire response at a given minScore (defaults to the base
 *  dataset). Blocks below minScore are nulled → their cells render `sold`. */
export function togetherResponse(minScore = 0, party = 2): TogetherResponseShape {
  const results = BASE_RESULTS.map((r) => ({
    ...r,
    block: r.block && r.block.avgScore >= minScore ? r.block : null,
  }));
  return { party, minScore, count: results.length, results };
}

/** A ScoredSeatMap for the drill-in confirm. The drill-in now trusts the LIVE recomputed
 *  `block` (server-side, P0), so the response carries `block`/`blocks` mirroring the real
 *  /seatmap?party=&minScore= shape — NOT the cached block. Includes the great block's seat
 *  ids as `available` so the L4.5 highlight assertion (`.seat--hi`) passes.
 *  `blockGone: true` omits one block seat → no adjacent pair → live `block: null` (the #38 path). */
export function seatmapResponse(opts: { blockGone?: boolean } = {}) {
  const ids = opts.blockGone ? ["L7"] : GREAT_BLOCK_SEAT_IDS;
  const seats = ids.map((id, i) => ({
    id,
    name: id,
    rowLabel: "L",
    row: 0,
    col: i + 1,
    status: "available" as const,
    areaId: "area1",
  }));
  // A couple of sold seats so the map is not trivially the block alone.
  seats.push(
    { id: "L1", name: "L1", rowLabel: "L", row: 0, col: 10, status: "sold" as const, areaId: "area1" },
    { id: "L2", name: "L2", rowLabel: "L", row: 0, col: 11, status: "sold" as const, areaId: "area1" },
  );
  // Live adjacency over the available seats for party 2: L7+L8 are contiguous (cols 1,2) → a block;
  // blockGone leaves only L7 → no pair → null. Mirrors core.findAdjacentBlocks / the live API.
  const block = opts.blockGone
    ? null
    : { row: 0, rowLabel: "L", startCol: 1, seatIds: [...GREAT_BLOCK_SEAT_IDS], avgScore: 95, minScore: 94 };
  return {
    chain: "event",
    sessionId: "A-27-imax",
    areas: [{ id: "area1", name: "Stalls", kind: "standard" }],
    seats,
    scored: seats
      .filter((s) => s.status === "available")
      .map((s, i) => ({ seat: s, score: 95 - i })),
    block,
    blocks: block ? [block] : [],
    party: 2,
    minScore: 74,
  };
}
