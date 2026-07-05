// Thin typed client for /options and the /catalog `titles` extension (docs/47a-contract.md).
// Both endpoints are being built in parallel by another agent — there is no live implementation
// yet. In dev mode, a network failure (or a /catalog response with no `titles` yet) falls back to
// the contract's fixture data so `npm run dev` and screenshots work without a live backend. In
// production this fallback never fires — a real failure surfaces as a real error to the caller.

import { API_BASE, fetchCatalog } from "../api";
import type { CatalogTitle, OptionsResponse } from "./types";
import {
  CATALOG_TITLES_FIXTURE,
  NO_GOOD_SEATS_OPTIONS_FIXTURE,
  OPTIONS_FIXTURE,
  OPTIONS_FIXTURES_BY_CHAIN,
} from "./fixture";

async function getJson<T>(path: string, qs: URLSearchParams): Promise<T> {
  const query = qs.toString();
  const url = `${API_BASE}${path}${query ? `?${query}` : ""}`;
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

export interface OptionsQuery {
  movieKey: string;
  party?: number;
  minScore?: number;
}

const isDev = (): boolean => {
  try {
    return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
};

/** Picks the matching dev-mode fixture by movieKey, so Screen 0's "No Great Seats Tonight" mock
 *  title actually renders the honest no-good-seats state rather than the Dune fixture. Every real
 *  /options call returns exactly one chain's options (contract §3/§6) — so the fixture must be
 *  selected (and never mixed) per the requested movieKey's chain, not a shared multi-chain blob. */
function fixtureFor(movieKey: string): OptionsResponse {
  if (movieKey === NO_GOOD_SEATS_OPTIONS_FIXTURE.movieKey) return NO_GOOD_SEATS_OPTIONS_FIXTURE;
  const chain = movieKey.split(":")[0];
  const fixture = OPTIONS_FIXTURES_BY_CHAIN[chain] ?? OPTIONS_FIXTURE;
  return { ...fixture, movieKey: movieKey || fixture.movieKey };
}

/** GET /options?movieKey&party&minScore. Falls back to the fixture in dev mode on any failure. */
export async function fetchOptions(q: OptionsQuery): Promise<OptionsResponse> {
  const qs = new URLSearchParams({ movieKey: q.movieKey });
  if (q.party !== undefined) qs.set("party", String(q.party));
  if (q.minScore !== undefined) qs.set("minScore", String(q.minScore));
  try {
    return await getJson<OptionsResponse>("/options", qs);
  } catch (err) {
    if (isDev()) {
      console.warn("[/options] live API unavailable, using contract fixture mock data", err);
      return fixtureFor(q.movieKey);
    }
    throw err;
  }
}

/** GET /catalog[?chain=]'s new `titles` array. Falls back to the fixture in dev mode when the
 *  live /catalog hasn't shipped the extension yet, or is unreachable entirely. */
export async function fetchCatalogTitles(chain?: string): Promise<CatalogTitle[]> {
  try {
    const res = (await fetchCatalog(chain)) as { titles?: CatalogTitle[] };
    if (res.titles && res.titles.length > 0) return res.titles;
    if (isDev()) return CATALOG_TITLES_FIXTURE;
    return res.titles ?? [];
  } catch (err) {
    if (isDev()) {
      console.warn("[/catalog titles] live API unavailable, using contract fixture mock data", err);
      return CATALOG_TITLES_FIXTURE;
    }
    throw err;
  }
}
