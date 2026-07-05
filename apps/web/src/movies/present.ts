// Small presentation helpers for the option cards. Kept separate from the API-shape module
// (types.ts) so display formatting can be unit-tested without dragging in components.

import { chainLabel } from "../format";
import type { Option, OptionFreshness } from "./types";

/**
 * Contract §5's "cinemaName never empty" holds only in steady state — the API's blank-name
 * backfill is a cache-only COALESCE onto the most recent non-blank name per (chain, cinemaId), so
 * Hoyts/Reading rows can still arrive with `cinemaName: ""` during a transition window (pre-first-
 * post-fix-ingest). Degrade gracefully to the chain label rather than rendering blank.
 */
export function displayCinemaName(o: Option): string {
  return o.cinemaName.trim() || chainLabel(o.chain);
}

/** Format badge for an Option (contract §1.4's classifier already ran server-side — this just
 *  renders the result). Mirrors ../format.ts's formatBadge() shape for the shared .tag--format CSS. */
export function optionFormatBadge(o: Option): { label: string; premium: boolean } | null {
  if (!o.isLargeFormat) return null;
  const label = o.format.trim() || (o.formatRank === 2 ? "IMAX" : "Large format");
  return { label, premium: true };
}

/** Fit-tier readout per the wireframe's "all N together / N nearby / M of N" language. */
export function fitTierLabel(o: Option, party: number): string {
  switch (o.fitTier) {
    case "together":
      return `All ${o.togetherCount} together`;
    case "nearby":
      return `${o.togetherCount} nearby`;
    case "split":
      return `${o.togetherCount} of ${party}`;
  }
}

/**
 * Honest per-card freshness readout (contract §1.3: per-card state is only "fresh" or "stale" —
 * "not-cached" is reserved for the whole-response coverage object and can never appear here).
 * `now` is injectable for deterministic tests.
 */
export function freshnessLabel(f: OptionFreshness, now: number = Date.now()): string {
  const ms = Math.max(0, now - new Date(f.asOf).getTime());
  const hours = Math.round(ms / 3_600_000);
  const asOfText = hours < 1 ? "moments ago" : `${hours}h ago`;
  return f.state === "stale" ? `Stale · as of ${asOfText}` : `As of ${asOfText}`;
}
