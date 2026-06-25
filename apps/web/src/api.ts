import type { BestResponse, Cinema, Movie, ScoredSeatMap, AreaKind } from "./types";
import type { TogetherResult } from "./together/matrix";

// Empty => same-origin relative requests, served via the Vite dev/preview proxy
// (see vite.config.ts) or a reverse proxy in production. Set VITE_API_BASE to an
// absolute, CORS-enabled API URL to talk to it directly instead.
export const API_BASE: string = (
  (import.meta.env.VITE_API_BASE as string | undefined) ?? ""
).replace(/\/$/, "");

/** Seat-preference / scoring controls shared by /best and /seatmap. */
export interface ScoringParams {
  targetDepth: number;
  depthWeight: number;
  centralityWeight: number;
  allowedAreaKinds: AreaKind[];
  avoidPaired: boolean;
}

/**
 * Default scoring profile. Mirrors QueryForm DEFAULTS scoring fields; the
 * Seats-Together drill-in confirm uses this so its live /seatmap call matches
 * the best-seat mode's default scoring (#37 / L3.5).
 */
export const DEFAULT_SCORING: ScoringParams = {
  targetDepth: 0.65,
  depthWeight: 0.5,
  centralityWeight: 0.5,
  allowedAreaKinds: [],
  avoidPaired: false,
};

export interface BestQuery extends ScoringParams {
  chain: string;
  movieId: string;
  cinemaIds: string; // comma-separated, as typed
  date: string; // YYYY-MM-DD
  topN: number;
}

function scoringToParams(p: ScoringParams, qs: URLSearchParams): void {
  qs.set("targetDepth", String(p.targetDepth));
  qs.set("depthWeight", String(p.depthWeight));
  qs.set("centralityWeight", String(p.centralityWeight));
  qs.set("avoidPaired", String(p.avoidPaired));
  if (p.allowedAreaKinds.length > 0) {
    qs.set("allowedAreaKinds", p.allowedAreaKinds.join(","));
  }
}

async function getJson<T>(path: string, qs: URLSearchParams): Promise<T> {
  const url = `${API_BASE}${path}?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      /* non-JSON error body - keep statusText */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

export function fetchCinemas(chain: string): Promise<Cinema[]> {
  const qs = new URLSearchParams({ chain });
  return getJson<Cinema[]>("/cinemas", qs);
}

export function fetchMovies(
  chain: string,
  cinemaIds: string,
  date: string,
): Promise<Movie[]> {
  const qs = new URLSearchParams({ chain, cinemaIds, date });
  return getJson<Movie[]>("/movies", qs);
}

export function fetchBest(q: BestQuery): Promise<BestResponse> {
  const qs = new URLSearchParams({
    chain: q.chain,
    movieId: q.movieId,
    cinemaIds: q.cinemaIds,
    date: q.date,
    topN: String(q.topN),
  });
  scoringToParams(q, qs);
  return getJson<BestResponse>("/best", qs);
}

/** Seats-Together query. ONE /together call per (movie, party, minScore);
 *  format/time/day filtering is applied client-side via the L2 layer. */
export interface TogetherQuery {
  chain: string;
  movieId: string;
  party: number;
  minScore: number;
  /** Optional scan-axis narrowing; omitted => the watch's full scope. */
  cinemaIds?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface TogetherResponse {
  party: number;
  minScore: number;
  count: number;
  results: TogetherResult[];
}

export function getTogether(q: TogetherQuery): Promise<TogetherResponse> {
  const qs = new URLSearchParams({
    chain: q.chain,
    party: String(q.party),
    minScore: String(q.minScore),
  });
  if (q.movieId) qs.set("movieId", q.movieId);
  if (q.cinemaIds) qs.set("cinemaIds", q.cinemaIds);
  if (q.dateFrom) qs.set("dateFrom", q.dateFrom);
  if (q.dateTo) qs.set("dateTo", q.dateTo);
  return getJson<TogetherResponse>("/together", qs);
}

export function fetchSeatMap(
  chain: string,
  sessionId: string,
  scoring: ScoringParams,
): Promise<ScoredSeatMap> {
  const qs = new URLSearchParams({ chain, sessionId });
  scoringToParams(scoring, qs);
  return getJson<ScoredSeatMap>("/seatmap", qs);
}
