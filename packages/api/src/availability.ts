/**
 * #47b — GET /availability engine port (docs/47b-contract.md §2/§3/§4).
 *
 * packages/core/src/leadtime.ts stays untouched and pure (§0 hard constraint) — it's still the
 * SessionAvailability[] -> LeadTimeReport aggregator, called exactly once per request. What's new
 * here is entirely upstream/downstream of that call: assembling SessionAvailability[] from a DB read
 * (mirrors /together's block-building step, reusing findAdjacentBlocks — no reimplementation), then
 * grouping the resulting per-SESSION timeline into the per-DATE rows this module's contract needs.
 * All DB-read plumbing lives here (an API-local helper module), never inside packages/core.
 */
import {
  buildLeadTimeReport,
  findAdjacentBlocks,
  tierForDayDiff,
  type BlockSeat,
  type RefreshTier,
} from "@auscinema/core";
import type { Pool } from "./db.js";

const MS_PER_DAY = 86_400_000;

// --- shapes -------------------------------------------------------------------------------------

/** One live `sessions` row projected to just what the engine port needs. */
export interface AvailabilitySessionRow {
  id: string;
  /** "YYYY-MM-DD". */
  date: string;
  /** Local wall time, as `leadtime.ts`'s SessionAvailability expects (fake-`Z` tolerant). */
  startTime: string;
  /** sessions.total_seats — sellable capacity (#47b). NULL pre-migration/not-yet-refreshed (§4.3). */
  totalSeats: number | null;
  /** sessions.seats_available. */
  availableSeats: number | null;
  /** ISO UTC fetched_at. */
  fetchedAt: string;
}

export type AvailabilityState =
  | "good-block"
  | "no-qualifying-block"
  | "sold-held-now"
  | "stale"
  | "not-cached";

export interface AvailabilityDate {
  date: string;
  state: AvailabilityState;
  leadDays: number;
  bestBlockScore: number | null;
  soldHeldPct: number | null;
  asOf: string | null;
}

export interface BuildAvailabilityOptions {
  /** Party size, >= 1. */
  party: number;
  /** Minimum per-seat score, 0..100. */
  minScore: number;
  /** "YYYY-MM-DD" Sydney-today — injected; this module never reads a clock itself. */
  today: string;
  /** Inclusive upper bound of the emitted `dates[]` range — "YYYY-MM-DD" (maxCachedDate ?? horizonDate). */
  rangeEnd: string;
  /**
   * #86 fix — tier-aware staleness gate. A date's staleness threshold (ms) is keyed by the SAME
   * `RefreshTier` the ingester's refresh scheduler (packages/ingester/src/refresh.ts) uses for that
   * date's proximity, resolved from the SHARED packages/core/src/refresh-tiers.ts constants
   * (env-overridable, margin-applied). This replaces the old single fixed `staleMs` (2h for every
   * date regardless of tier) — that fixed gate is exactly what caused #86: a far-out (T2) date, whose
   * scheduler promise is a 24h TTL, was reported `stale` at just ~19.5h old, permanently nulling
   * `earliest` for any movie whose only cached dates were T2. See `resolveStaleMsByTier` in
   * packages/api/src/index.ts for how this map is built.
   */
  staleMsByTier: Record<RefreshTier, number>;
  /** AVAILABILITY_SOLD_HELD_THRESHOLD_PCT, default 90 (see resolveSoldHeldThresholdPct). */
  soldHeldThresholdPct: number;
  /** Date.now()-equivalent instant (ms), injected for deterministic staleness tests. */
  now: number;
}

/** Result of {@link buildAvailabilityDates} — the per-date rows plus the #86-fix honest fallback. */
export interface AvailabilityDatesResult {
  dates: AvailabilityDate[];
  /**
   * #86 fix, part (b): the earliest (chronological) date that WOULD be `good-block` if it weren't
   * stale — i.e. it has a qualifying `party`-size block, but its freshest session is older than its
   * tier's staleness threshold. `null` when no such date exists (either every stale date lacks a
   * qualifying block, or there are no stale dates at all). Unlike `dates[]`'s own `stale` rows (which
   * never leak `bestBlockScore`, per §3's per-cell honesty contract), this field DELIBERATELY carries
   * `bestBlockScore` — it exists specifically so the API/header can surface an honest "as of" answer
   * instead of asserting `earliest: null` (false absence) when qualifying-but-stale data exists.
   */
  earliestStale: AvailabilityDate | null;
}

// --- env config -----------------------------------------------------------------------------

const DEFAULT_SOLD_HELD_THRESHOLD_PCT = 90;

/** §3: "highly sold" threshold, env-overridable, defaulting to 90. Read per-request (cheap). */
export function resolveSoldHeldThresholdPct(env: Record<string, string | undefined> = process.env): number {
  const raw = env.AVAILABILITY_SOLD_HELD_THRESHOLD_PCT;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : DEFAULT_SOLD_HELD_THRESHOLD_PCT;
}

// --- date helpers (leadtime.ts's own internal helpers stay module-private + untouched; this is a
// deliberate 3-line recompute per the contract's own §2 step-5 permission) ----------------------

function utcMidnight(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

/** Whole UTC-midnight day diff from `today` to `date`, clamped >= 0 — same contract as leadtime.ts's
 *  internal (module-private) `leadDays`. */
function leadDaysFrom(today: string, date: string): number {
  const diff = Math.round((utcMidnight(date) - utcMidnight(today)) / MS_PER_DAY);
  return diff > 0 ? diff : 0;
}

/** Inclusive "YYYY-MM-DD" range [from, to] via UTC-midnight arithmetic. Empty when to < from. */
function dateRange(from: string, to: string): string[] {
  const start = utcMidnight(from);
  const end = utcMidnight(to);
  const out: string[] = [];
  for (let ms = start; ms <= end; ms += MS_PER_DAY) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

// --- pure aggregation (contract §2 steps 1-6, §3, §4) ------------------------------------------

/**
 * Build the per-date `AvailabilityDate[]` rows. Pure — no I/O, `now`/`today` injected — so this is
 * unit-testable against fixtures without Postgres (fixture parity with leadtime.ts's own semantics:
 * the SAME `findAdjacentBlocks`/`buildLeadTimeReport` calls, just per-day rather than per-session).
 */
export function buildAvailabilityDates(
  sessions: readonly AvailabilitySessionRow[],
  seatsBySession: ReadonlyMap<string, readonly BlockSeat[]>,
  opts: BuildAvailabilityOptions,
): AvailabilityDatesResult {
  const { party, minScore, today, rangeEnd, staleMsByTier, soldHeldThresholdPct, now } = opts;

  // Step 3: one SessionAvailability per session, exactly as /together builds its blocks — reusing
  // findAdjacentBlocks, not reimplementing it. totalSeats/availableSeats default to 0 when NULL
  // (pre-migration rows) purely for core's own (unused-by-us) per-session soldPct field — this
  // module's OWN soldHeldPct (§4.3) is computed below directly from the raw nullable columns, so
  // "unknown capacity" is never silently coerced to a fabricated 0 in the response.
  const availabilities = sessions.map((row) => ({
    sessionId: row.id,
    date: row.date,
    startTime: row.startTime,
    totalSeats: row.totalSeats ?? 0,
    availableSeats: row.availableSeats ?? 0,
    blocks: findAdjacentBlocks(seatsBySession.get(row.id) ?? [], { minScore, size: party }),
  }));

  // Step 4: buildLeadTimeReport ONCE — gives the session-level timeline (already sorted ascending
  // by date/startTime), which step 5 groups by date.
  const report = buildLeadTimeReport(availabilities, { party, minScore, today });

  const rowById = new Map(sessions.map((r) => [r.id, r]));
  const byDate = new Map<string, typeof report.timeline>();
  for (const entry of report.timeline) {
    let arr = byDate.get(entry.date);
    if (!arr) {
      arr = [];
      byDate.set(entry.date, arr);
    }
    arr.push(entry);
  }

  const dates: AvailabilityDate[] = [];
  let earliestStale: AvailabilityDate | null = null;
  for (const date of dateRange(today, rangeEnd)) {
    const entries = byDate.get(date);
    const leadDays = leadDaysFrom(today, date);

    // Step 6: zero cached sessions this date -> synthetic not-cached row.
    if (!entries || entries.length === 0) {
      dates.push({ date, state: "not-cached", leadDays, bestBlockScore: null, soldHeldPct: null, asOf: null });
      continue;
    }

    let asOf: string | null = null;
    let totalSum = 0;
    let takenSum = 0;
    let haveCapacity = false;
    let hasQualifying = false;
    let bestBlockScore: number | null = null;

    for (const entry of entries) {
      const raw = rowById.get(entry.sessionId)!;
      // asOf: freshest fetched_at wins ("trust the newest" convention, same as /options per-card).
      if (asOf === null || raw.fetchedAt > asOf) asOf = raw.fetchedAt;

      if (entry.hasQualifyingPair) {
        hasQualifying = true;
        const score = entry.bestPairScore;
        if (score !== null && (bestBlockScore === null || score > bestBlockScore)) bestBlockScore = score;
      }

      // §4.3: aggregate only over sessions that HAVE total_seats — partial-data-friendly, not a
      // whole-date drop to null just because one session in the mix lacks capacity data.
      if (raw.totalSeats !== null && raw.totalSeats !== undefined) {
        haveCapacity = true;
        totalSum += raw.totalSeats;
        takenSum += raw.totalSeats - (raw.availableSeats ?? 0);
      }
    }

    // §4.3: null (never a fabricated 0) when no session that date has total_seats, or the summed
    // capacity is <= 0 (defensive, mirrors leadtime.ts's own soldPct() contract).
    // 47c fix #12: clamp to [0, 100] — a live incident showed -3% sold/held (availableSeats can
    // exceed totalSeats across mixed-freshness rows within the same date, going negative before
    // clamping; over-100 is symmetrically guarded even though it hasn't been observed live). A
    // negative/over-100 percentage reads as broken math, not an honest data state.
    const soldHeldPct =
      haveCapacity && totalSum > 0
        ? Math.max(0, Math.min(100, Math.round((100 * takenSum) / totalSum)))
        : null;

    // #86 fix: staleness is TIER-AWARE — this date's proximity maps to the SAME RefreshTier the
    // ingester's refresh scheduler uses for it (packages/core's tierForDayDiff, shared boundaries), so
    // the threshold is that tier's own (margin-applied) TTL, not one fixed gate for every date
    // regardless of how far out it is.
    const tier = tierForDayDiff(leadDays);
    const staleMs = staleMsByTier[tier];

    // §3 state-selection order: not-cached (handled above) -> stale -> sold-held-now -> good-block
    // -> no-qualifying-block.
    const isStale = asOf !== null && now - Date.parse(asOf) >= staleMs;
    let state: AvailabilityState;
    if (isStale) {
      state = "stale";
    } else if (!hasQualifying && soldHeldPct !== null && soldHeldPct >= soldHeldThresholdPct) {
      state = "sold-held-now";
    } else if (hasQualifying) {
      state = "good-block";
    } else {
      state = "no-qualifying-block";
    }

    dates.push({
      date,
      state,
      leadDays,
      // bestBlockScore is only ever surfaced for a confidently-reported good-block date (§1.2) —
      // a stale date with an internally-qualifying session must not leak a bestBlockScore in the
      // per-cell array (the honest fallback for a stale-but-qualifying date is `earliestStale` below,
      // computed separately and never written back into this cell).
      bestBlockScore: state === "good-block" ? bestBlockScore : null,
      soldHeldPct,
      asOf,
    });

    // #86 fix, part (b): track the earliest (chronological — we're iterating dateRange ascending)
    // stale-but-qualifying date, so the caller can surface an honest "as of" answer instead of a false
    // absence claim when `earliest` (first good-block) is null.
    if (earliestStale === null && state === "stale" && hasQualifying) {
      earliestStale = { date, state, leadDays, bestBlockScore, soldHeldPct, asOf };
    }
  }

  return { dates, earliestStale };
}

// --- DB read (the ONLY I/O in this module) -----------------------------------------------------

export interface FetchAvailabilityParams {
  chain: string;
  movieId: string;
  cinemaId?: string;
  /** "YYYY-MM-DD" Sydney-today — same liveness filter as /together/§2's aggregation table. */
  today: string;
}

type Queryable = Pick<Pool, "query">;

/** Live sessions for (movieKey[, cinemaId]) — same liveness filter as /together (disappeared_at IS
 *  NULL AND date >= today). One SQL query (contract §2 step 1). */
export async function fetchAvailabilitySessions(
  db: Queryable,
  params: FetchAvailabilityParams,
): Promise<AvailabilitySessionRow[]> {
  const clauses = ["chain = $1", "movie_id = $2", "disappeared_at IS NULL", "date >= $3"];
  const values: unknown[] = [params.chain, params.movieId, params.today];
  if (params.cinemaId !== undefined) {
    values.push(params.cinemaId);
    clauses.push(`cinema_id = $${values.length}`);
  }

  const { rows } = await db.query<{
    id: string;
    date: string;
    start_time: string | null;
    total_seats: number | null;
    seats_available: number | null;
    fetched_at: string;
  }>(
    `SELECT id, date::text AS date,
            to_char(start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS start_time,
            total_seats, seats_available,
            to_char(fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fetched_at
       FROM sessions
      WHERE ${clauses.join(" AND ")}`,
    values,
  );

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    startTime: r.start_time ?? `${r.date}T00:00`,
    totalSeats: r.total_seats,
    availableSeats: r.seats_available,
    fetchedAt: r.fetched_at,
  }));
}

/** Batch-load session_seats for a set of session ids — same table/shape /together already reads
 *  (contract §2 step 2). Empty input short-circuits with zero DB round trips. */
export async function fetchSeatsBySession(
  db: Queryable,
  sessionIds: readonly string[],
): Promise<Map<string, BlockSeat[]>> {
  const seatsBySession = new Map<string, BlockSeat[]>();
  if (sessionIds.length === 0) return seatsBySession;

  const { rows } = await db.query<{
    session_id: string;
    seat_id: string;
    row_label: string | null;
    row: number;
    col: number;
    score: number;
  }>(
    `SELECT session_id, seat_id, row_label, row, col, score
       FROM session_seats
      WHERE session_id = ANY($1::text[])`,
    [sessionIds],
  );
  for (const s of rows) {
    let arr = seatsBySession.get(s.session_id);
    if (!arr) {
      arr = [];
      seatsBySession.set(s.session_id, arr);
    }
    arr.push({ id: s.seat_id, rowLabel: s.row_label ?? "", row: s.row, col: s.col, score: s.score });
  }
  return seatsBySession;
}
