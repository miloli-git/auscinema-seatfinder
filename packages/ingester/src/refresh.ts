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
import type { Pool } from "./db.js";
import type { AdapterRegistry } from "./registry.js";
import { upsertSessionWithSeats } from "./persist.js";
import { sessionToUpsert, toSeatUpserts } from "./sweep.js";
import { datesInRange, loadEnabledWatches, watchToQuery } from "./watches.js";
import { effectiveWindow, resolveHorizonDays } from "./horizon.js";
import type { SessionUpsert, WatchRow } from "./types.js";

// --- C1 tiering --------------------------------------------------------------

export type RefreshTier = "T0" | "T1" | "T2";

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
  if (diff <= 1) return "T0";
  if (diff <= 7) return "T1";
  return "T2";
}

// --- TTL config (env-overridable) + bounded jitter ---------------------------

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Base TTL per tier (ms). Defaults T0 1h / T1 6h / T2 24h, each env-overridable. */
function baseTtlMs(tier: RefreshTier): number {
  switch (tier) {
    case "T0":
      return envMs("REFRESH_TTL_T0_MS", 60 * 60_000);
    case "T1":
      return envMs("REFRESH_TTL_T1_MS", 6 * 60 * 60_000);
    case "T2":
      return envMs("REFRESH_TTL_T2_MS", 24 * 60 * 60_000);
  }
}

/** Per-chain reserved first-ingest lane size (#60). Env REFRESH_RESERVE_NEW_PER_CHAIN, default 10. */
function resolveReserveForNew(): number {
  const raw = process.env.REFRESH_RESERVE_NEW_PER_CHAIN;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 10;
}

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
 */
function orderDue(due: KnownSession[]): KnownSession[] {
  const ordered: KnownSession[] = [];
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
    // Bucket order: most-stale bucket (smallest min fetchedAt) first.
    const oldestOf = (b: KnownSession[]): number =>
      b.reduce((min, s) => Math.min(min, s.fetchedAt.getTime()), Number.POSITIVE_INFINITY);
    bucketList.sort((a, b) => oldestOf(a) - oldestOf(b));

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
  opts: { budgetPerChain: number; reserveForNew?: number; nowInstant: Date },
): SelectResult {
  const { budgetPerChain, nowInstant } = opts;
  const reserveForNew = Math.max(0, opts.reserveForNew ?? 0);

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
    const ordered = orderDue(due);
    // Reserved first-ingest lane: up to `reserveForNew` never-fetched sessions, in orderDue priority,
    // guaranteed even when the normal budget is fully consumed. reserveForNew=0 short-circuits to the
    // exact pre-#60 behaviour (the main pass slices `ordered` from index 0).
    const reservedIds = new Set<string>();
    if (reserveForNew > 0) {
      for (const s of ordered) {
        if (reservedIds.size >= reserveForNew) break;
        if (s.neverFetched) reservedIds.add(s.sessionId);
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
  const seenIds = new Set<string>();
  const conclusiveScopes = new Set<string>();
  const scopeKey = (chain: string, cinemaId: string, date: string, movieId: string): string =>
    `${chain}|${cinemaId}|${date}|${movieId}`;

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
          // The cinema/date/movie of each returned session is conclusively listed this tick.
          conclusiveScopes.add(scopeKey(s.chain, s.cinemaId, s.startTime.slice(0, 10), s.movieId));
          if (!s.startTime.startsWith(date)) continue;
          if (!s.seatAllocation) continue;
          if (!discovered.has(s.id)) discovered.set(s.id, { session: s, watch: w });
        }
      } catch {
        bumpDiscoveryError(w.chain);
      }
    }
  }

  /** True iff a known session's own (chain,cinema,date,movie) scope was conclusively listed this tick. */
  const inListedScope = (chain: Chain, cinemaId: string, date: string, movieId: string): boolean =>
    conclusiveScopes.has(scopeKey(chain, cinemaId, date, movieId));

  // --- build candidate set: known cached sessions + newly-discovered ones.
  const targets = new Map<string, FetchTarget>();
  const candidates: KnownSession[] = [];

  const knownRows = (
    await pool.query<KnownDbRow>(
      `SELECT id, watch_id, chain, movie_id, movie_name, cinema_id, cinema_name, date,
              start_time, format, screen, seats_available, booking_url, seat_allocation, fetched_at,
              disappeared_at
         FROM sessions`,
    )
  ).rows;

  // P30.2 (C6) tombstone/resurrection transitions, computed in JS then persisted in two UPDATEs.
  const toTombstone: string[] = [];
  const toResurrect: string[] = [];

  for (const r of knownRows) {
    const dateStr = ymdOf(r.date);
    const tier = tierForSessionDate(dateStr, nowInstant);

    const wasTombstoned = r.disappeared_at != null;
    const seen = seenIds.has(r.id);
    // A tombstoned session listed again resurrects; a live in-scope session that vanished tombstones.
    const willResurrect = wasTombstoned && seen;
    const willTombstone = !wasTombstoned && !seen && inListedScope(r.chain, r.cinema_id, dateStr, r.movie_id);
    if (willResurrect) toResurrect.push(r.id);
    if (willTombstone) toTombstone.push(r.id);
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
    const upsert: SessionUpsert = {
      id: r.id,
      watchId: Number(r.watch_id ?? 0),
      chain: r.chain,
      movieId: r.movie_id,
      ...(r.movie_name != null ? { movieName: r.movie_name } : {}),
      cinemaId: r.cinema_id,
      ...(r.cinema_name != null ? { cinemaName: r.cinema_name } : {}),
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
  // resurrected session keeps its cleared tombstone after its refresh.
  if (toResurrect.length > 0) {
    await pool.query("UPDATE sessions SET disappeared_at = NULL WHERE id = ANY($1::text[])", [toResurrect]);
  }
  if (toTombstone.length > 0) {
    await pool.query("UPDATE sessions SET disappeared_at = $1 WHERE id = ANY($2::text[])", [
      nowInstant,
      toTombstone,
    ]);
  }

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
  const sel = selectDueSessions(candidates, { budgetPerChain, reserveForNew, nowInstant });

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
          await upsertSessionWithSeats(pool, target.upsert, seats);
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
