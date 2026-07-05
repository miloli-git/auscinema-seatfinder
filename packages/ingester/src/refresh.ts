/**
 * Tiered refresh (#30 P30.1). One tick:
 *   acquire advisory lock (C3) -> discover-if-due -> selectDueSessions (C2) ->
 *   fetch under per-chain budget + backoff (C5) -> upsert (reuse upsertSessionWithSeats) ->
 *   write ONE refresh_runs row (C4) -> release.
 *
 * Tiering (C1) is computed on the Australia/Sydney CALENDAR. Session showtimes are local
 * wall-time mislabelled with a trailing `Z` (the fake-`Z` path, see apps/web/src/format.ts),
 * so the session date is compared by SUBSTRING and never UTC-parsed.
 */
import type { Chain, SeatPreference, Session } from "@auscinema/core";
import {
  resolveTierTtlMs,
  tierForDayDiff,
  type RefreshTier as CoreRefreshTier,
} from "@auscinema/core";
import type { Pool } from "./db.js";
import type { AdapterRegistry } from "./registry.js";
import {
  healSessionNames,
  updateWildcardMissStreaks,
  upsertSessionWithSeats,
  type NameHeal,
} from "./persist.js";
import { countSeatableTotal, sessionToUpsert, toSeatUpserts } from "./sweep.js";
import { datesInRange, loadEnabledWatches, watchToQuery } from "./watches.js";
import { effectiveWindow, horizonDate, resolveHorizonDays } from "./horizon.js";
import type { SessionUpsert, WatchRow } from "./types.js";

// --- C1 tiering --------------------------------------------------------------

/** Re-exported from packages/core/src/refresh-tiers.ts (#86 fix) — the SHARED tier type, so
 *  refresh.ts and availability.ts can never drift on what a "tier" is. */
export type RefreshTier = CoreRefreshTier;

const SYDNEY_TZ = "Australia/Sydney";
const MS_PER_DAY = 86_400_000;
const DEFAULT_CONCURRENCY = 4;

/** Deterministic, documented advisory-lock key for the refresh tick (#30 P30.1). */
const ADVISORY_LOCK_KEY = 30_300_101;

/** Australia/Sydney calendar date "YYYY-MM-DD" for a true UTC instant. */
function sydneyDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SYDNEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Whole-day difference between two "YYYY-MM-DD" calendar dates (b - a), TZ-safe via UTC midnight. */
function dayDiff(aYmd: string, bYmd: string): number {
  const a = Date.parse(`${aYmd}T00:00:00Z`);
  const b = Date.parse(`${bYmd}T00:00:00Z`);
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * Tier a session by its Australia/Sydney calendar date relative to `nowInstant`.
 * `sessionDate` is fake-`Z` local wall-time — only its YYYY-MM-DD prefix is used (substring,
 * never UTC-parsed). T0 = today+tomorrow, T1 = 2-7 days out, T2 = 8 days+.
 */
export function tierForSessionDate(sessionDate: string, nowInstant: Date): RefreshTier {
  const sessionYmd = sessionDate.slice(0, 10);
  const today = sydneyDate(nowInstant);
  const diff = dayDiff(today, sessionYmd);
  return tierForDayDiff(diff);
}

// --- TTL config (env-overridable) + bounded jitter ---------------------------

/** Base TTL per tier (ms). Defaults T0 1h / T1 6h / T2 24h (packages/core's DEFAULT_TIER_TTL_MS),
 *  each env-overridable via the SHARED env var names in packages/core's TIER_TTL_ENV_VAR (#86 fix —
 *  this used to be a locally-duplicated switch statement; the `/availability` staleness gate must
 *  read the exact same numbers, so both now delegate to packages/core/src/refresh-tiers.ts). */
function baseTtlMs(tier: RefreshTier): number {
  return resolveTierTtlMs(tier, process.env);
}

/** Per-chain reserved first-ingest lane size (#60). Env REFRESH_RESERVE_NEW_PER_CHAIN, default 10. */
function resolveReserveForNew(): number {
  const raw = process.env.REFRESH_RESERVE_NEW_PER_CHAIN;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 10;
}

/**
 * #46 fix (3a): never-fetched sessions within this many days of the rolling horizon's far edge
 * (today + horizonDays) are excluded from the guaranteed reserveForNew lane. Without this, a brand
 * new date enters discovery every tick at exactly `today+horizonDays` and always wins the reserved
 * lane (fresh within minutes), while already-known, already-cached mid-window T2 dates never clear
 * their backlog against the shared budget — the RCA's "Aug10-always-fresh-while-Jul16-starves"
 * defect. Excluded sessions still get picked up: they compete via the normal budget, which is now
 * proximity-weighted (see `orderDue`) and so naturally sorts them behind nearer T2 dates rather than
 * jumping ahead of them. Env REFRESH_RESERVE_NEW_EDGE_EXCLUDE_DAYS, default 2; 0 disables the
 * exclusion (legacy behaviour: every never-fetched session, including the horizon edge, is eligible).
 */
function resolveReserveNewEdgeExcludeDays(): number {
  const raw = process.env.REFRESH_RESERVE_NEW_EDGE_EXCLUDE_DAYS;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 2;
}

/**
 * #78 review: consecutive-tick debounce for wildcard-scope-ONLY-conclusive tombstones. A genuine
 * zombie still tombstones within one extra tick (~30min at the production 15-min cadence with the
 * default of 2) - an acceptable trade against irreversibly tombstoning a session on a single transient
 * gap. Env WILDCARD_TOMBSTONE_MISSES, default 2.
 */
function resolveWildcardTombstoneMisses(): number {
  const raw = process.env.WILDCARD_TOMBSTONE_MISSES;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 2;
}

/**
 * #78 review: chains whose adapter provably issues one upstream request PER cinemaId and fails the
 * whole listSessions() call if any of them fails (event/hoyts/reading - see event adapter's C8
 * comment). That per-cinemaId atomicity is exactly what makes "a session was returned for this
 * cinema/date" conclusive evidence for the WHOLE cinema/date scope (#77). Village is deliberately
 * excluded: its adapter issues one COMBINED Algolia query capped at 1000 results with no truncation
 * check (see packages/adapters/village/src/index.ts's module doc comment) - a large/busy cinema slice
 * of that single query could be silently truncated, so "a session was returned" is NOT proof the
 * whole scope was listed. Adding village here requires a truncation guard in its adapter first (e.g.
 * asserting hits.length < 1000, or paginating past the cap).
 */
const WILDCARD_SCOPE_CONCLUSIVE_CHAINS: ReadonlySet<Chain> = new Set(["event", "hoyts", "reading"]);

function jitterFraction(): number {
  const raw = process.env.REFRESH_TTL_JITTER;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.15;
}

/** Deterministic per-session unit in [0,1) (FNV-1a) so the jittered TTL is stable per session. */
function unitHash(sessionId: string): number {
  let h = 2166136261;
  for (let i = 0; i < sessionId.length; i++) {
    h ^= sessionId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0x100000000;
}

/** Jittered TTL (ms) for a session: base * (1 +/- jitter), bounded to +/-jitter of base. */
function ttlMsFor(tier: RefreshTier, sessionId: string): number {
  const j = jitterFraction();
  const frac = (unitHash(sessionId) * 2 - 1) * j; // [-j, +j]
  return baseTtlMs(tier) * (1 + frac);
}

// --- C2 due selection + fairness ---------------------------------------------

export interface KnownSession {
  sessionId: string;
  chain: Chain;
  cinemaId: string;
  /** "YYYY-MM-DD". */
  date: string;
  fetchedAt: Date;
  tier: RefreshTier;
  live: boolean;
  /** True for discovered-new sessions (epoch fetchedAt); existing cached rows are false. */
  neverFetched: boolean;
}

/** Dropped count for one (chain, tier, cinemaId, date) bucket — no silent caps. */
export interface SkipCount {
  chain: string;
  tier: RefreshTier;
  cinemaId: string;
  date: string;
  count: number;
}

export interface SelectResult {
  selected: string[];
  skipped: SkipCount[];
}

const TIER_ORDER: RefreshTier[] = ["T0", "T1", "T2"];

/**
 * Order one chain's due sessions for budgeting: tier priority (T0->T1->T2), then round-robin
 * across real (cinemaId, date) buckets so a dense cinema cannot consume the whole budget.
 * Bucket priority is the most-stale bucket first (oldest member's fetchedAt), and within a bucket
 * the STALEST (oldest fetchedAt) come first — a refresh-ahead scheduler must refresh the stalest
 * first, so the over-budget tail that gets dropped is the freshest slice.
 *
 * #46 fix (2): T0/T1 bucket ordering is untouched (staleness-only, as above). Within T2, bucket
 * priority is instead day-distance-from-today ASCENDING (nearer dates first), tie-broken by
 * staleness — T2 spans "8 days+" with no further tiering, so a session 10 days out and one 35 days
 * out previously competed on staleness alone, and a `neverFetched` (epoch fetchedAt) session at the
 * horizon's far edge always looked "stalest" and jumped every already-cached nearer date. Proximity
 * as the PRIMARY key means near-term T2 dates drain their backlog before far-horizon ones, which is
 * exactly the RCA's "Aug10-always-fresh-while-Jul16-starves" defect.
 */
function orderDue(due: KnownSession[], nowInstant: Date): KnownSession[] {
  const ordered: KnownSession[] = [];
  const today = sydneyDate(nowInstant);
  for (const tier of TIER_ORDER) {
    const inTier = due.filter((d) => d.tier === tier);
    if (inTier.length === 0) continue;

    const buckets = new Map<string, KnownSession[]>();
    for (const s of inTier) {
      const key = `${s.cinemaId}|${s.date}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = [];
        buckets.set(key, bucket);
      }
      bucket.push(s);
    }

    const bucketList = [...buckets.values()];
    // Within a bucket: stalest (oldest fetchedAt) first.
    for (const b of bucketList) b.sort((x, y) => x.fetchedAt.getTime() - y.fetchedAt.getTime());
    const oldestOf = (b: KnownSession[]): number =>
      b.reduce((min, s) => Math.min(min, s.fetchedAt.getTime()), Number.POSITIVE_INFINITY);

    if (tier === "T2") {
      // Bucket order: nearest date first, staleness only as a tie-break between same-date buckets.
      const distanceOf = (b: KnownSession[]): number => dayDiff(today, b[0]!.date);
      bucketList.sort((a, b) => distanceOf(a) - distanceOf(b) || oldestOf(a) - oldestOf(b));
    } else {
      // T0/T1: unchanged — most-stale bucket (smallest min fetchedAt) first.
      bucketList.sort((a, b) => oldestOf(a) - oldestOf(b));
    }

    // Round-robin: one from each bucket per round, in bucket-priority order.
    const maxLen = bucketList.reduce((m, b) => Math.max(m, b.length), 0);
    for (let i = 0; i < maxLen; i++) {
      for (const b of bucketList) {
        const item = b[i];
        if (item) ordered.push(item);
      }
    }
  }
  return ordered;
}

/**
 * Select due sessions under a per-chain budget. Due iff age(now - fetchedAt) >= jittered TTL(tier).
 * `live: false` sessions are ignored. Over-budget sessions are reported in `skipped` keyed by
 * (chain, tier, cinemaId, date) — never a silent cap.
 */
/** True iff a known session is live and its age has reached its jittered TTL for the tier. */
export function isDue(k: KnownSession, nowInstant: Date): boolean {
  if (k.live === false) return false;
  const age = nowInstant.getTime() - k.fetchedAt.getTime();
  return age >= ttlMsFor(k.tier, k.sessionId);
}

export function selectDueSessions(
  known: KnownSession[],
  opts: {
    budgetPerChain: number;
    reserveForNew?: number;
    nowInstant: Date;
    /** #46 fix (3a): "YYYY-MM-DD" far edge of the rolling horizon (today + horizonDays). Required
     *  (together with `reserveNewEdgeExcludeDays`) to exclude horizon-edge never-fetched sessions
     *  from the reserved lane. Omitted = no exclusion (legacy behaviour). */
    horizonEdgeDate?: string;
    /** #46 fix (3a): sessions within this many days of `horizonEdgeDate` are excluded from the
     *  reserveForNew lane. 0 or omitted = no exclusion (legacy behaviour). */
    reserveNewEdgeExcludeDays?: number;
  },
): SelectResult {
  const { budgetPerChain, nowInstant, horizonEdgeDate } = opts;
  const reserveForNew = Math.max(0, opts.reserveForNew ?? 0);
  const reserveNewEdgeExcludeDays = Math.max(0, opts.reserveNewEdgeExcludeDays ?? 0);
  // A session is "near the horizon edge" iff its date is within `reserveNewEdgeExcludeDays` of the
  // far edge (i.e. horizonEdgeDate - excludeDays <= s.date <= horizonEdgeDate). Disabled (always
  // false) when the caller doesn't supply the horizon edge or sets excludeDays to 0.
  const isNearHorizonEdge = (date: string): boolean => {
    if (!horizonEdgeDate || reserveNewEdgeExcludeDays <= 0) return false;
    const distanceFromEdge = dayDiff(date, horizonEdgeDate);
    return distanceFromEdge >= 0 && distanceFromEdge <= reserveNewEdgeExcludeDays;
  };

  const byChain = new Map<string, KnownSession[]>();
  for (const k of known) {
    if (!isDue(k, nowInstant)) continue;
    let list = byChain.get(k.chain);
    if (!list) {
      list = [];
      byChain.set(k.chain, list);
    }
    list.push(k);
  }

  const selected: string[] = [];
  const skipped: SkipCount[] = [];
  for (const due of byChain.values()) {
    const ordered = orderDue(due, nowInstant);
    // Reserved first-ingest lane: up to `reserveForNew` never-fetched sessions, in orderDue priority,
    // guaranteed even when the normal budget is fully consumed. reserveForNew=0 short-circuits to the
    // exact pre-#60 behaviour (the main pass slices `ordered` from index 0).
    // #46 fix (3a): a never-fetched session within `reserveNewEdgeExcludeDays` of the horizon's far
    // edge is skipped for the reserved lane — it still competes via the (now proximity-weighted)
    // main pass below instead of structurally jumping every already-cached nearer T2 date.
    const reservedIds = new Set<string>();
    if (reserveForNew > 0) {
      for (const s of ordered) {
        if (reservedIds.size >= reserveForNew) break;
        if (s.neverFetched && !isNearHorizonEdge(s.date)) reservedIds.add(s.sessionId);
      }
    }
    // Main pass: fill budgetPerChain from the remaining due (excluding reserved), preserving orderDue.
    const mainKeep: KnownSession[] = [];
    const budget = Math.max(0, budgetPerChain);
    for (const s of ordered) {
      if (reservedIds.has(s.sessionId)) continue;
      if (mainKeep.length >= budget) break;
      mainKeep.push(s);
    }
    const selectedSet = new Set<string>(reservedIds);
    for (const s of mainKeep) selectedSet.add(s.sessionId);
    // Emit in orderDue order so reserveForNew=0 reproduces the legacy selection byte-for-byte.
    for (const s of ordered) if (selectedSet.has(s.sessionId)) selected.push(s.sessionId);
    const drop = ordered.filter((s) => !selectedSet.has(s.sessionId));

    if (drop.length > 0) {
      const agg = new Map<string, SkipCount>();
      for (const s of drop) {
        const key = `${s.chain}|${s.tier}|${s.cinemaId}|${s.date}`;
        const row = agg.get(key);
        if (row) row.count++;
        else agg.set(key, { chain: s.chain, tier: s.tier, cinemaId: s.cinemaId, date: s.date, count: 1 });
      }
      for (const row of agg.values()) skipped.push(row);
    }
  }

  return { selected, skipped };
}

// --- C0 tick runner ----------------------------------------------------------

export interface RefreshTickDeps {
  pool: Pool;
  registry: AdapterRegistry;
  nowInstant: Date;
  budgetPerChain: number;
  concurrency?: number;
}

export interface RefreshRunRow {
  id: number;
  started_at: Date;
  finished_at: Date | null;
  outcome: "ok" | "lock_skipped" | "error";
  sessions_due: number;
  sessions_refreshed: number;
  sessions_skipped_budget: number;
  sessions_new: number;
  sessions_disappeared: number;
  errors: number;
  per_chain: unknown;
  per_tier: unknown;
}

interface RefreshCounts {
  outcome: "ok" | "lock_skipped" | "error";
  sessionsDue: number;
  sessionsRefreshed: number;
  sessionsSkippedBudget: number;
  sessionsNew: number;
  sessionsDisappeared: number;
  errors: number;
  perChain: Record<string, unknown>;
  perTier: Record<string, unknown>;
}

interface KnownDbRow {
  id: string;
  watch_id: string | number | null;
  chain: Chain;
  movie_id: string;
  movie_name: string | null;
  cinema_id: string;
  cinema_name: string | null;
  date: string | Date;
  start_time: string | Date | null;
  format: string | null;
  screen: string | null;
  seats_available: number | null;
  booking_url: string | null;
  seat_allocation: boolean | null;
  fetched_at: string | Date;
  disappeared_at: string | Date | null;
  wildcard_miss_streak: number;
}

/** Normalise a DATE column (pg may return a Date or a string) to "YYYY-MM-DD". */
function ymdOf(v: string | Date): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

/** Bounded-concurrency map (same polite-fetch pattern as sweep.ts / watcher). */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const run = async (): Promise<void> => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i] as T, i);
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run);
  await Promise.all(workers);
  return results;
}

/** Anything that can run a parameterised query — the pool or a checked-out client. */
type Queryable = Pick<Pool, "query">;

async function writeRefreshRun(db: Queryable, startedAt: Date, c: RefreshCounts): Promise<RefreshRunRow> {
  const { rows } = await db.query<RefreshRunRow>(
    `INSERT INTO refresh_runs
       (started_at, finished_at, outcome, sessions_due, sessions_refreshed, sessions_skipped_budget,
        sessions_new, sessions_disappeared, errors, per_chain, per_tier)
     VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
     RETURNING id, started_at, finished_at, outcome, sessions_due, sessions_refreshed,
               sessions_skipped_budget, sessions_new, sessions_disappeared, errors, per_chain, per_tier`,
    [
      startedAt,
      c.outcome,
      c.sessionsDue,
      c.sessionsRefreshed,
      c.sessionsSkippedBudget,
      c.sessionsNew,
      c.sessionsDisappeared,
      c.errors,
      JSON.stringify(c.perChain),
      JSON.stringify(c.perTier),
    ],
  );
  const row = rows[0]!;
  return { ...row, id: Number(row.id) };
}

interface FetchTarget {
  upsert: SessionUpsert;
  chain: Chain;
  pref?: SeatPreference;
  isNew: boolean;
}

interface ChainStat {
  due: number;
  refreshed: number;
  skipped: number;
  /** Seat-refresh errors on DUE sessions only — these are the errors the ledger invariant counts. */
  errors: number;
  /** Discovery (listSessions) errors — accounted separately so the ledger invariant holds (NEW-HIGH). */
  discovery_errors: number;
  backoff: boolean;
  skipped_buckets: { tier: RefreshTier; cinemaId: string; date: string; count: number }[];
}

/**
 * The locked body of a tick. Discovers new sessions, selects the due set under per-chain budget,
 * fetches + upserts with per-chain isolated concurrency, and returns the ledger counters. Throws on
 * a hard failure (e.g. the DB going away) — the caller writes the `outcome='error'` row.
 */
async function runLockedTick(deps: RefreshTickDeps): Promise<RefreshCounts> {
  const { pool, registry, nowInstant, budgetPerChain } = deps;
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
  const sydneyToday = sydneyDate(nowInstant);

  // --- discovery: list current sessions, find newly-appeared ones (P30.1: no tombstones).
  const watches = await loadEnabledWatches(pool);

  // #60 rolling horizon: the SINGLE source of truth for both discovery AND inScope. A watch's static
  // dateTo no longer caps the window — `to` rolls to today+H; `from` clamps up to today (never the past).
  const horizonDays = resolveHorizonDays();
  const windowFor = new Map<number, { from: string; to: string } | null>();
  for (const w of watches) windowFor.set(w.id, effectiveWindow(w, sydneyToday, horizonDays));

  /**
   * A known session is in active refresh scope iff it is upcoming and inside an enabled watch
   * matching its chain, cinema, date AND movie, within that watch's rolling window. A null watch
   * `movieId` is the all-movies wildcard for that chain/cinema/date (MED-2).
   */
  const inScope = (chain: Chain, cinemaId: string, date: string, movieId: string): boolean => {
    if (date < sydneyToday) return false; // past — out of scope until P30.2 liveness/tombstones
    for (const w of watches) {
      const eff = windowFor.get(w.id);
      if (
        eff !== null &&
        eff !== undefined &&
        w.chain === chain &&
        w.cinemaIds.includes(cinemaId) &&
        date >= eff.from &&
        date <= eff.to &&
        (w.movieId === null || w.movieId === movieId)
      ) {
        return true;
      }
    }
    return false;
  };

  const existing = new Set<string>(
    (await pool.query<{ id: string }>("SELECT id FROM sessions")).rows.map((r) => r.id),
  );

  // Discovery errors are counted per chain so an upstream listing outage backs the chain off
  // instead of silently producing a clean tick (MED-1).
  const discoveryErrors = new Map<string, number>();
  const bumpDiscoveryError = (chain: string): void =>
    void discoveryErrors.set(chain, (discoveryErrors.get(chain) ?? 0) + 1);

  // P30.2 (C6) tombstone bookkeeping. The conclusive unit is a single (chain, cinemaId, date, movie)
  // scope that ACTUALLY APPEARED in a listing — derived per RETURNED session, NOT from the watch's
  // declared cinemaIds. So a multi-cinema watch whose merged listing returns only C1 sessions marks
  // C1 conclusive but NOT C2: C2 had zero returned sessions, which is inconclusive (an endpoint hiccup
  // is likelier than a cinema emptying), so cached C2 sessions are never tombstoned this tick — they
  // age out via the past-date filter instead. Every returned id is "seen this tick"; a known session
  // whose own scope was conclusively listed but is absent from `seenIds` is tombstoned. A failed
  // listing yields no returned sessions, so an outage never mass-tombstones.
  //
  // #77: the per-movieId scope above can never be marked conclusive for a movie that has been fully
  // delisted upstream — no returned session will ever again carry that exact movieId, so absence of
  // evidence for it can never itself become evidence of absence. For a WILDCARD watch (`movieId:
  // null` — what every production watch in deploy/watches.json uses), the underlying listing already
  // returns every movie currently showing at that cinema/date; seeing ANY session for a given
  // cinemaId/date is proof the whole scope was listed, which is conclusive for every movieId in it,
  // not just the ones that happened to still have sessions. This is safe against the same "endpoint
  // hiccup" concern the per-movieId key protects against for multi-cinema listings: every chain
  // adapter (event/hoyts/reading) issues ONE upstream request PER cinemaId and a failure on any of
  // them fails the whole listSessions() call (see e.g. packages/adapters/event/src/index.ts's C8
  // comment) — so a returned session for cinemaId C is already proof C's listing for that date fully
  // succeeded, per-cinemaId, regardless of how many cinemaIds were requested together. A
  // movie-specific watch's response is pre-filtered to one movieId and can't attest to other movies
  // at that cinema/date, so it keeps the original narrower key.
  const seenIds = new Set<string>();
  const conclusiveScopes = new Set<string>();
  const scopeKey = (chain: string, cinemaId: string, date: string, movieId: string): string =>
    `${chain}|${cinemaId}|${date}|${movieId}`;
  /** #77 wildcard-widened scope: (chain, cinemaId, date) only, conclusive for every movieId. */
  const conclusiveWildcardScopes = new Set<string>();
  const wildcardScopeKey = (chain: string, cinemaId: string, date: string): string =>
    `${chain}|${cinemaId}|${date}`;

  const discovered = new Map<string, { session: Session; watch: WatchRow }>();
  for (const w of watches) {
    const adapter = registry[w.chain];
    if (!adapter) continue;
    const eff = windowFor.get(w.id);
    if (!eff) continue; // watch starts beyond the rolling horizon — nothing to discover this tick
    for (const date of datesInRange(eff.from, eff.to)) {
      try {
        const sessions = await adapter.listSessions(watchToQuery(w, date));
        for (const s of sessions) {
          seenIds.add(s.id);
          const sessionDate = s.startTime.slice(0, 10);
          // The cinema/date/movie of each returned session is conclusively listed this tick.
          conclusiveScopes.add(scopeKey(s.chain, s.cinemaId, sessionDate, s.movieId));
          // #77: a wildcard watch's response is the FULL multi-movie listing for this cinema/date —
          // any session returned for it conclusively lists every movieId in that scope, delisted ones
          // included. #78: gated to the adapter allowlist above — village's single capped/untruncated
          // Algolia query can't back this guarantee.
          if (w.movieId === null && WILDCARD_SCOPE_CONCLUSIVE_CHAINS.has(s.chain)) {
            conclusiveWildcardScopes.add(wildcardScopeKey(s.chain, s.cinemaId, sessionDate));
          }
          if (!s.startTime.startsWith(date)) continue;
          if (!s.seatAllocation) continue;
          if (!discovered.has(s.id)) discovered.set(s.id, { session: s, watch: w });
        }
      } catch {
        bumpDiscoveryError(w.chain);
      }
    }
  }

  /** Null/empty (post-trim) counts as blank — the #67/#72 stale-cache symptom. */
  const isBlank = (v: string | null | undefined): boolean => v == null || v.trim() === "";

  /**
   * #67/#72 self-heal: a known session id's upsert used to be built ENTIRELY from its existing DB
   * row, and `discovered` entries for already-known ids were discarded outright (the `existing.has`
   * skip below) — so a blank/stale cached name could never be overwritten by a fresh chain listing,
   * even though the adapter-side fixes (#69 cinemaName, #72 Hoyts movieName) return the real value on
   * every listSessions() call. Policy (conservative v1): fresh wins ONLY when the current DB value is
   * blank; a non-blank DB value is left alone even if the fresh listing disagrees, since a rename vs.
   * a bad-data race can't be told apart here. Seat/total_seats flow is untouched by this helper.
   */
  const healedName = (dbValue: string | null, freshValue: string | undefined): string | null =>
    isBlank(dbValue) && !isBlank(freshValue) ? (freshValue as string) : dbValue;

  // --- build candidate set: known cached sessions + newly-discovered ones.
  const targets = new Map<string, FetchTarget>();
  const candidates: KnownSession[] = [];

  const knownRows = (
    await pool.query<KnownDbRow>(
      `SELECT id, watch_id, chain, movie_id, movie_name, cinema_id, cinema_name, date,
              start_time, format, screen, seats_available, booking_url, seat_allocation, fetched_at,
              disappeared_at, wildcard_miss_streak
         FROM sessions`,
    )
  ).rows;

  // P30.2 (C6) tombstone/resurrection transitions, computed in JS then persisted in two UPDATEs.
  const toTombstone: string[] = [];
  const toResurrect: string[] = [];
  // #78 review: sessions whose wildcard_miss_streak changes but that are NOT also being
  // tombstoned/resurrected this tick (those two paths reset the streak as part of their own UPDATE).
  const missStreakUpdates = new Map<string, number>();
  const wildcardTombstoneMisses = resolveWildcardTombstoneMisses();

  // #67/#72 review follow-up: name heals computed below, collected here and written ONCE per tick
  // via `healSessionNames` — independent of due/budget/seatmap outcome (see that fn's doc comment).
  const nameHeals: NameHeal[] = [];

  for (const r of knownRows) {
    const dateStr = ymdOf(r.date);
    const tier = tierForSessionDate(dateStr, nowInstant);

    const wasTombstoned = r.disappeared_at != null;
    const seen = seenIds.has(r.id);
    // A tombstoned session listed again resurrects; a live in-scope session that vanished tombstones.
    const willResurrect = wasTombstoned && seen;

    // #78 review: the narrow per-movieId scope is EXACT evidence (a session for THIS movieId was
    // returned this tick), so it keeps the pre-#78 immediate-tombstone behaviour. The coarse wildcard
    // scope (#77) is evidence about the cinema/date listing as a whole, not this movie specifically —
    // a transient one-tick gap must not tombstone irreversibly (7-day purge) on its first miss, so a
    // wildcard-ONLY-conclusive absence must accumulate `wildcardTombstoneMisses` CONSECUTIVE misses
    // (env WILDCARD_TOMBSTONE_MISSES, default 2) before it stamps disappeared_at. Any tick where the
    // session IS seen resets the streak to 0 — presence is always full evidence against absence.
    const narrowConclusive = conclusiveScopes.has(scopeKey(r.chain, r.cinema_id, dateStr, r.movie_id));
    const wildcardOnlyConclusive =
      !narrowConclusive && conclusiveWildcardScopes.has(wildcardScopeKey(r.chain, r.cinema_id, dateStr));

    let willTombstone = false;
    let nextMissStreak = r.wildcard_miss_streak;
    if (!wasTombstoned && !seen) {
      if (narrowConclusive) {
        willTombstone = true; // exact evidence — unchanged immediate behaviour.
      } else if (wildcardOnlyConclusive) {
        nextMissStreak = r.wildcard_miss_streak + 1;
        willTombstone = nextMissStreak >= wildcardTombstoneMisses;
      }
      // else: this scope was not conclusively listed at all this tick (an endpoint hiccup, or simply
      // never queried) — no evidence either way, so the streak is left untouched.
    } else if (seen && r.wildcard_miss_streak !== 0) {
      nextMissStreak = 0;
    }

    if (willResurrect) toResurrect.push(r.id);
    if (willTombstone) toTombstone.push(r.id);
    if (!willResurrect && !willTombstone && nextMissStreak !== r.wildcard_miss_streak) {
      missStreakUpdates.set(r.id, nextMissStreak);
    }
    const effectivelyTombstoned = (wasTombstoned && !willResurrect) || willTombstone;

    candidates.push({
      sessionId: r.id,
      chain: r.chain,
      cinemaId: r.cinema_id,
      date: dateStr,
      fetchedAt: r.fetched_at instanceof Date ? r.fetched_at : new Date(r.fetched_at),
      tier,
      // Out-of-scope / past / tombstoned sessions are kept non-live so they never consume refresh
      // budget and are never counted as due/refreshed (MED-2 + C6 ledger invariant).
      live: inScope(r.chain, r.cinema_id, dateStr, r.movie_id) && !effectivelyTombstoned,
      neverFetched: false,
    });
    const watch = r.watch_id != null ? watches.find((w) => w.id === Number(r.watch_id)) : undefined;
    const startTime =
      r.start_time == null
        ? undefined
        : r.start_time instanceof Date
          ? r.start_time.toISOString()
          : String(r.start_time);
    // #67/#72 self-heal: use this tick's fresh discovery data (if this id was returned) to fill in a
    // blank cached name. See `healedName` above for the fresh-wins-only-when-blank policy.
    const freshSession = discovered.get(r.id)?.session;
    const movieName = healedName(r.movie_name, freshSession?.movieName);
    const cinemaName = healedName(r.cinema_name, freshSession?.cinemaName);
    if (movieName !== r.movie_name || cinemaName !== r.cinema_name) {
      nameHeals.push({ id: r.id, movieName, cinemaName });
    }
    const upsert: SessionUpsert = {
      id: r.id,
      watchId: Number(r.watch_id ?? 0),
      chain: r.chain,
      movieId: r.movie_id,
      ...(movieName != null ? { movieName } : {}),
      cinemaId: r.cinema_id,
      ...(cinemaName != null ? { cinemaName } : {}),
      date: dateStr,
      ...(startTime !== undefined ? { startTime } : {}),
      ...(r.format != null ? { format: r.format } : {}),
      ...(r.screen != null ? { screen: r.screen } : {}),
      ...(r.seats_available != null ? { seatsAvailable: r.seats_available } : {}),
      ...(r.booking_url != null ? { bookingUrl: r.booking_url } : {}),
      ...(r.seat_allocation != null ? { seatAllocation: r.seat_allocation } : {}),
    };
    targets.set(r.id, { upsert, chain: r.chain, pref: watch?.scoring ?? undefined, isNew: false });
  }

  // Persist C6 transitions. Resurrect first (clear), then stamp new tombstones with the injected
  // `nowInstant` (deterministic, NOT now()). Seat upserts below never touch disappeared_at, so a
  // resurrected session keeps its cleared tombstone after its refresh. #78: both transitions also
  // reset wildcard_miss_streak to 0 — "resurrect must reset the counter", and a fresh tombstone
  // starts a clean slate should it ever resurrect and drift again later.
  if (toResurrect.length > 0) {
    await pool.query(
      "UPDATE sessions SET disappeared_at = NULL, wildcard_miss_streak = 0 WHERE id = ANY($1::text[])",
      [toResurrect],
    );
  }
  if (toTombstone.length > 0) {
    await pool.query(
      "UPDATE sessions SET disappeared_at = $1, wildcard_miss_streak = 0 WHERE id = ANY($2::text[])",
      [nowInstant, toTombstone],
    );
  }
  // #78: persist wildcard-scope miss-streak increments/resets for rows NOT already covered above.
  await updateWildcardMissStreaks(pool, missStreakUpdates);

  // #67/#72 review follow-up: write every computed name heal now, ONCE per tick, decoupled from the
  // due/budget/seatmap-gated upsert path below. A known row that is not due, is skipped by budget, or
  // whose seatmap fetch fails/429s still gets its blank name healed here.
  await healSessionNames(pool, nameHeals);

  // Newly-discovered sessions: maximally stale (epoch fetchedAt) so they are always due this tick.
  for (const { session, watch } of discovered.values()) {
    if (existing.has(session.id)) continue;
    const date = session.startTime.slice(0, 10);
    const tier = tierForSessionDate(session.startTime, nowInstant);
    candidates.push({
      sessionId: session.id,
      chain: session.chain,
      cinemaId: session.cinemaId,
      date,
      fetchedAt: new Date(0),
      tier,
      live: inScope(session.chain, session.cinemaId, date, session.movieId),
      neverFetched: true,
    });
    targets.set(session.id, {
      upsert: sessionToUpsert(session, watch.id),
      chain: session.chain,
      pref: watch.scoring ?? undefined,
      isNew: true,
    });
  }

  const dueCandidates = candidates.filter((c) => isDue(c, nowInstant));
  // #60 reserved first-ingest lane: env-resolved in the caller (default 10), passed into the pure fn.
  const reserveForNew = resolveReserveForNew();
  // #46 fix (3a): the rolling horizon's far edge, so the reserved lane can exclude never-fetched
  // sessions right at that edge (env-resolved exclusion window, default 2 days).
  const sel = selectDueSessions(candidates, {
    budgetPerChain,
    reserveForNew,
    nowInstant,
    horizonEdgeDate: horizonDate(sydneyToday, horizonDays),
    reserveNewEdgeExcludeDays: resolveReserveNewEdgeExcludeDays(),
  });

  // --- per-chain accounting.
  const perChain = new Map<string, ChainStat>();
  const chainStat = (chain: string): ChainStat => {
    let st = perChain.get(chain);
    if (!st) {
      st = { due: 0, refreshed: 0, skipped: 0, errors: 0, discovery_errors: 0, backoff: false, skipped_buckets: [] };
      perChain.set(chain, st);
    }
    return st;
  };
  // due counts the WHOLE due set (selected + budget-skipped), not just attempted (HIGH-1).
  for (const c of dueCandidates) chainStat(c.chain).due++;
  // skipped detail keyed by (tier, cinemaId, date) is preserved per chain (HIGH-2).
  for (const s of sel.skipped) {
    const st = chainStat(s.chain);
    st.skipped += s.count;
    st.skipped_buckets.push({ tier: s.tier, cinemaId: s.cinemaId, date: s.date, count: s.count });
  }
  // Discovery errors are accounted SEPARATELY from due-session refresh errors so the ledger
  // invariant (sessions_due = refreshed + errors + skipped) holds on a discovery-error tick (NEW-HIGH).
  for (const [chain, n] of discoveryErrors) chainStat(chain).discovery_errors += n;

  // --- fetch + upsert under ISOLATED per-chain concurrency (MED-3): a slow/down chain cannot
  // occupy another chain's workers, so per-chain budgets and backoff actually isolate.
  const selectedByChain = new Map<Chain, string[]>();
  for (const id of sel.selected) {
    const chain = targets.get(id)!.chain;
    let ids = selectedByChain.get(chain);
    if (!ids) {
      ids = [];
      selectedByChain.set(chain, ids);
    }
    ids.push(id);
  }

  let refreshed = 0;
  let fetchErrors = 0;
  let sessionsNew = 0;
  await Promise.all(
    [...selectedByChain.entries()].map(([chain, ids]) =>
      mapWithConcurrency(ids, concurrency, async (id) => {
        const target = targets.get(id)!;
        const adapter = registry[chain];
        try {
          if (!adapter) throw new Error(`no adapter for chain "${chain}"`);
          const map = await adapter.getSeatMap(id, { preview: true });
          const seats = toSeatUpserts(map, target.pref);
          // #47b: refresh is a real second write path for total_seats — without this, a session's
          // total_seats would silently regress to stale/null on every refresh after initial ingest.
          const totalSeats = countSeatableTotal(map);
          await upsertSessionWithSeats(pool, { ...target.upsert, totalSeats }, seats);
          chainStat(chain).refreshed++;
          refreshed++;
          if (target.isNew) sessionsNew++;
        } catch {
          chainStat(chain).errors++;
          fetchErrors++;
        }
      }),
    ),
  );

  // --- backoff: a chain is backed off when a majority of its attempts (seat-refresh + discovery)
  // failed. Discovery errors still feed this classification even though they're a separate counter.
  for (const st of perChain.values()) {
    const failures = st.errors + st.discovery_errors;
    const attempts = st.refreshed + failures;
    st.backoff = attempts > 0 && (failures === attempts || failures > attempts / 2);
  }

  const perChainObj: Record<string, unknown> = {};
  for (const [chain, st] of perChain) {
    perChainObj[chain] = {
      due: st.due,
      refreshed: st.refreshed,
      skipped: st.skipped,
      errors: st.errors,
      discovery_errors: st.discovery_errors,
      backoff: st.backoff,
      skipped_buckets: st.skipped_buckets,
    };
  }

  // --- per-tier distribution over the WHOLE due set (selected + skipped) (HIGH-1).
  const perTierObj: Record<string, { count: number; oldest_age_s: number; newest_age_s: number }> = {};
  for (const cand of dueCandidates) {
    const ageS = Math.max(0, Math.round((nowInstant.getTime() - cand.fetchedAt.getTime()) / 1000));
    const slot =
      perTierObj[cand.tier] ??
      (perTierObj[cand.tier] = { count: 0, oldest_age_s: 0, newest_age_s: Number.MAX_SAFE_INTEGER });
    slot.count++;
    slot.oldest_age_s = Math.max(slot.oldest_age_s, ageS);
    slot.newest_age_s = Math.min(slot.newest_age_s, ageS);
  }
  for (const slot of Object.values(perTierObj)) {
    if (slot.newest_age_s === Number.MAX_SAFE_INTEGER) slot.newest_age_s = 0;
  }

  const skippedBudget = sel.skipped.reduce((sum, s) => sum + s.count, 0);

  return {
    outcome: "ok",
    sessionsDue: dueCandidates.length,
    sessionsRefreshed: refreshed,
    sessionsSkippedBudget: skippedBudget,
    sessionsNew,
    sessionsDisappeared: toTombstone.length,
    // Top-level `errors` = seat-refresh errors of DUE sessions only, so the documented invariant
    // `sessions_due = sessions_refreshed + errors + sessions_skipped_budget` holds every tick.
    // Discovery errors live in per_chain[chain].discovery_errors (NEW-HIGH).
    errors: fetchErrors,
    perChain: perChainObj,
    perTier: perTierObj,
  };
}

/** A non-null all-zero ledger payload for the lock-skipped / error rows. */
function emptyCounts(outcome: "lock_skipped" | "error"): RefreshCounts {
  return {
    outcome,
    sessionsDue: 0,
    sessionsRefreshed: 0,
    sessionsSkippedBudget: 0,
    sessionsNew: 0,
    sessionsDisappeared: 0,
    errors: outcome === "error" ? 1 : 0,
    perChain: {},
    perTier: {},
  };
}

/**
 * Run one refresh tick. Acquires a deterministic advisory lock so two ticks / two containers never
 * sweep concurrently; a tick that cannot acquire the lock writes a `lock_skipped` row and performs
 * ZERO upstream fetches. A tick that throws after acquiring the lock writes a best-effort
 * `outcome='error'` row (non-null counters) and rethrows. Either way it releases the lock and
 * returns/raises with exactly one `refresh_runs` row written. Returns the row on success.
 */
export async function runRefreshTick(deps: RefreshTickDeps): Promise<RefreshRunRow> {
  const { pool } = deps;
  const startedAt = new Date();

  const lockClient = await pool.connect();
  let locked = false;
  try {
    const lockRes = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [ADVISORY_LOCK_KEY],
    );
    locked = lockRes.rows[0]?.locked === true;
    if (!locked) {
      return await writeRefreshRun(pool, startedAt, emptyCounts("lock_skipped"));
    }

    try {
      const counts = await runLockedTick(deps);
      return await writeRefreshRun(pool, startedAt, counts);
    } catch (err) {
      // C4: one non-null ledger row per tick. Write the error row on the lock-holding connection so
      // it succeeds even when the work failed because `pool` queries are failing.
      try {
        await writeRefreshRun(lockClient, startedAt, emptyCounts("error"));
      } catch {
        // best-effort; the original error is the signal that matters.
      }
      throw err;
    }
  } finally {
    if (locked) {
      try {
        await lockClient.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
      } catch {
        // best-effort unlock; releasing the connection below drops the advisory lock regardless.
      }
    }
    lockClient.release();
  }
}

// --- C6 purge ----------------------------------------------------------------

export interface PurgeDisappearedDeps {
  pool: Pool;
  nowInstant: Date;
  retentionMs: number;
}

/**
 * Hard-delete tombstoned sessions whose `disappeared_at` is older than the retention window
 * (`disappeared_at < nowInstant - retentionMs`). Only tombstoned rows are touched — live and
 * recently-tombstoned sessions are retained. `session_seats` rows are removed by the FK
 * `ON DELETE CASCADE`. `nowInstant` is injected for deterministic tests.
 */
export async function purgeDisappearedSessions(deps: PurgeDisappearedDeps): Promise<void> {
  const cutoff = new Date(deps.nowInstant.getTime() - deps.retentionMs);
  await deps.pool.query(
    "DELETE FROM sessions WHERE disappeared_at IS NOT NULL AND disappeared_at < $1",
    [cutoff],
  );
}
