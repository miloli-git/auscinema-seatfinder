// Local mirror of docs/47a-contract.md's response shapes. Kept independent so the web
// build does not couple to the (parallel, not-yet-live) API package.
// Source of truth: docs/47a-contract.md §1.3, §2.

import type { Chain } from "../types";

export type FitTier = "together" | "nearby" | "split";

/** Per-option freshness (contract §1.3): "not-cached" is impossible here — reserved for the
 *  whole-response `freshness.coverage` semantics, never a per-card state. */
export type OptionFreshnessState = "fresh" | "stale";

export interface OptionFreshness {
  asOf: string; // ISO UTC instant (this session's own fetched_at)
  state: OptionFreshnessState;
}

export interface Option {
  chain: Chain;
  cinemaId: string;
  cinemaName: string; // never "" or null once #67 lands (contract §5)
  sessionId: string;
  startsAt: string; // local-wall-time-with-fake-Z, same convention as /together
  date: string; // YYYY-MM-DD
  format: string; // raw stored string; may be ""
  isLargeFormat: boolean;
  formatRank: 0 | 1 | 2;
  bestBlockScore: number | null;
  bestBlockSize: number | null;
  fitTier: FitTier;
  togetherCount: number;
  geometryConfidence: "exact" | "approximate";
  freshness: OptionFreshness;
  bookingUrl: string;
}

/** Whole-response freshness object — byte-identical shape to /together's. Aggregate, page-level. */
export interface ResponseFreshness {
  oldestFetchedAt: string;
  newestFetchedAt: string;
  lastSuccessfulIngestAt: string;
  coverage: Record<string, string>;
}

export interface OptionsResponse {
  movieKey: string;
  movieTitle: string;
  party: number;
  minScore: number;
  count: number;
  options: Option[];
  freshness: ResponseFreshness;
}

/** GET /catalog's new `titles` entry (contract §2) — what Screen 0's movie list renders. */
export interface CatalogTitle {
  movieKey: string; // "<chain>:<movieId>"
  chain: Chain;
  title: string; // "" if genuinely null in cache; never coalesced to movieId
  sessionCount: number;
}
