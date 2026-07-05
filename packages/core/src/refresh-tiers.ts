/**
 * Shared refresh-tier definitions (#86 fix, gh issue: "Availability staleness gate conflicts with
 * refresh tier TTLs"). Before this module existed, `packages/ingester/src/refresh.ts` (the refresh
 * scheduler's tier/TTL table) and `packages/api/src/availability.ts` (the `/availability` staleness
 * gate) each hardcoded their OWN copy of the tier boundaries and TTL defaults. Those two copies drifted
 * out of sync in spirit even when the literal numbers matched: the API used a single fixed 2h
 * staleness gate for every date regardless of how far out it was, while the scheduler only promises
 * freshness within a much longer TTL for far-out (T2) dates — so a T2 date refreshed exactly on the
 * scheduler's own promise (e.g. ~19.5h old, well inside the 24h T2 TTL) was still reported `stale` by
 * the API, making `earliest` permanently null for any movie whose only cached dates were T2.
 *
 * This module is the ONE place both packages read tier boundaries/TTLs from — no duplicated magic
 * numbers. Pure — no I/O, no `process.env` reads (packages/core stays I-O-free per its own
 * convention); callers resolve their own env override by passing in an env map.
 */

export type RefreshTier = "T0" | "T1" | "T2";

/**
 * Whole-day diff (target date - today, TZ-safe UTC-midnight arithmetic) upper bound for T0/T1 — T0 is
 * "today or tomorrow" (diff <= 1), T1 is "2-7 days out" (diff <= 7), T2 is everything beyond (8+ days).
 */
export const TIER_MAX_DAY_DIFF: Record<"T0" | "T1", number> = {
  T0: 1,
  T1: 7,
};

/** Classify a whole-day diff (target date - today) into a refresh tier. Same boundaries the ingester's
 *  refresh scheduler (`tierForSessionDate`) and the `/availability` staleness gate both use. */
export function tierForDayDiff(diff: number): RefreshTier {
  if (diff <= TIER_MAX_DAY_DIFF.T0) return "T0";
  if (diff <= TIER_MAX_DAY_DIFF.T1) return "T1";
  return "T2";
}

/** Base refresh-scheduler TTL (ms) per tier — the ingester's promise for how fresh a date's cached
 *  data will be kept. Defaults: T0 1h, T1 6h, T2 24h. Env-overridable per tier via {@link TIER_TTL_ENV_VAR}. */
export const DEFAULT_TIER_TTL_MS: Record<RefreshTier, number> = {
  T0: 60 * 60_000,
  T1: 6 * 60 * 60_000,
  T2: 24 * 60 * 60_000,
};

/** Env var name carrying each tier's TTL override — shared so the ingester and the API read the
 *  SAME key (this exact duplication-of-key-name-not-value is what let the two packages drift #86). */
export const TIER_TTL_ENV_VAR: Record<RefreshTier, string> = {
  T0: "REFRESH_TTL_T0_MS",
  T1: "REFRESH_TTL_T1_MS",
  T2: "REFRESH_TTL_T2_MS",
};

/** Resolve a tier's base TTL (ms) from an injected env map, falling back to {@link DEFAULT_TIER_TTL_MS}.
 *  Pure — the caller passes `process.env` (or a test fixture) explicitly. */
export function resolveTierTtlMs(
  tier: RefreshTier,
  env: Record<string, string | undefined>,
): number {
  const raw = env[TIER_TTL_ENV_VAR[tier]];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIER_TTL_MS[tier];
}

/**
 * Staleness-gate margin (#86 fix): the `/availability` staleness gate treats a date as stale only when
 * its age exceeds `margin * tierTtl`, not the raw scheduler TTL. The refresh scheduler's own promise is
 * "due for refresh by TTL," not "refreshed the INSTANT it hits TTL" — real ticks have selection/budget/
 * backoff latency on top of the TTL, so an honest staleness gate needs headroom for that latency or it
 * will flag data the scheduler is still well within its own promise for. Default 1.5x, env-overridable.
 */
export const DEFAULT_STALE_MARGIN = 1.5;
export const STALE_MARGIN_ENV_VAR = "AVAILABILITY_STALE_MARGIN";

/** Resolve the staleness-gate margin from an injected env map, falling back to {@link DEFAULT_STALE_MARGIN}. */
export function resolveStaleMargin(env: Record<string, string | undefined>): number {
  const raw = env[STALE_MARGIN_ENV_VAR];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STALE_MARGIN;
}
