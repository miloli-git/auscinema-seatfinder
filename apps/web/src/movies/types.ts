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

// --- #47b GET /availability (docs/47b-contract.md §1.2) ---------------------------------------
// Local mirror, same rationale as the block above: kept independent of the (parallel, not-yet-live)
// API package so the web build never couples to its internals.

/** Exhaustive per the contract (§3) — never a 6th "beyond horizon" value; that distinction is
 *  copy-only, derived client-side from `horizonDate`/`maxCachedDate` (§3.1). */
export type AvailabilityState =
  | "good-block"
  | "no-qualifying-block"
  | "sold-held-now"
  | "stale"
  | "not-cached";

export interface AvailabilityDate {
  date: string; // YYYY-MM-DD
  state: AvailabilityState;
  leadDays: number; // whole days from Sydney-today, >= 0
  bestBlockScore: number | null; // non-null only when state === "good-block"
  soldHeldPct: number | null; // null when not derivable (contract §4.3) — never a fabricated 0
  asOf: string | null; // ISO UTC; null for "not-cached"
}

export interface AvailabilityResponse {
  movieKey: string;
  cinemaId: string | null; // echoes the request; null when unscoped
  party: number;
  minScore: number;
  horizonDate: string; // same as /catalog: today + REFRESH_HORIZON_DAYS
  maxCachedDate: string | null; // same as /catalog: furthest live cached date
  earliest: AvailabilityDate | null; // first `dates` entry with state === "good-block"
  earliestLeadDays: number | null;
  dates: AvailabilityDate[]; // ascending by date, one row per cached date in [today, maxCachedDate]
}
