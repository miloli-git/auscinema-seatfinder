/**
 * API service - thin Fastify front for the chain adapters and the seat scorer.
 *
 *   GET /healthz
 *   GET /cinemas?chain=event
 *   GET /sessions?chain=event&movieId=..&cinemaIds=a,b&date=YYYY-MM-DD
 *   GET /seatmap?chain=event&sessionId=..            (+ scoring prefs -> `scored`)
 *   GET /best?chain=event&movieId=..&cinemaIds=..&date=..  (ranked sessions + top seats)
 *
 * Session listings are cached in-memory (minutes). Seat maps are always fetched live, though
 * `/best` reuses one fetch per session within a single request.
 */
import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import {
  rankSeats,
  scoreAvailableSeats,
  bestSeatScore,
  findAdjacentBlocks,
  UpstreamError,
  type BlockSeat,
  type Chain,
  type ChainAdapter,
  type ScoredSeat,
  type SeatPreference,
  type Session,
} from "@auscinema/core";
import { EventCinemasAdapter } from "@auscinema/adapter-event";
import { HoytsAdapter } from "@auscinema/adapter-hoyts";
import { ReadingAdapter } from "@auscinema/adapter-reading";
import { VillageAdapter } from "@auscinema/adapter-village";
import { createPoolFromEnv, type Pool } from "./db.js";

// --- Errors -----------------------------------------------------------------

/** Thrown by handlers/helpers to produce a JSON `{error}` body with a status code. */
class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

// --- Chain registry ---------------------------------------------------------

export type AdapterRegistry = Partial<Record<Chain, ChainAdapter>>;

/** Default registry - event/hoyts/reading/village all wired. */
function defaultAdapters(): AdapterRegistry {
  return {
    event: new EventCinemasAdapter(),
    hoyts: new HoytsAdapter(),
    reading: new ReadingAdapter(),
    village: new VillageAdapter(),
  };
}

function resolveAdapter(registry: AdapterRegistry, chainRaw: unknown): ChainAdapter {
  const chain = typeof chainRaw === "string" ? chainRaw : "";
  if (!chain) throw new HttpError(400, "missing required query param: chain");
  const adapter = registry[chain as Chain];
  if (!adapter) throw new HttpError(400, `unknown or unsupported chain: ${chain}`);
  return adapter;
}

// --- In-memory TTL cache ----------------------------------------------------

class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expires: number }>();
  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }
}

// --- Query parsing ----------------------------------------------------------

type Query = Record<string, unknown>;

function reqStr(q: Query, key: string): string {
  const v = q[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new HttpError(400, `missing required query param: ${key}`);
  }
  return v;
}

function optStr(q: Query, key: string): string | undefined {
  const v = q[key];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** Split a comma-separated list, trimming and dropping blanks. */
function csv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function optFloat(q: Query, key: string): number | undefined {
  const raw = optStr(q, key);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new HttpError(400, `query param ${key} must be a number`);
  return n;
}

function optInt(q: Query, key: string): number | undefined {
  const raw = optStr(q, key);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function optPositiveInt(q: Query, key: string): number | undefined {
  const n = optInt(q, key);
  return n !== undefined && n > 0 ? n : undefined;
}

function clampInt(n: number, min: number, max: number): number {
  const int = Number.isFinite(n) ? Math.trunc(n) : min;
  return Math.min(max, Math.max(min, int));
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message.length > 0 ? err.message : "unknown error";
}

function optBool(q: Query, key: string): boolean | undefined {
  const raw = optStr(q, key);
  if (raw === undefined) return undefined;
  return raw === "true" || raw === "1" || raw === "yes";
}

const MAX_BEST_TOP_N = 20;

const AREA_KINDS: SeatPreference["allowedAreaKinds"] = [
  "standard",
  "recliner",
  "premium",
  "goldclass",
  "daybed",
  "companion",
  "other",
];

/** Build a SeatPreference from the scoring query params (all optional). */
function parsePreference(q: Query): SeatPreference {
  const pref: SeatPreference = {};
  const targetDepth = optFloat(q, "targetDepth");
  if (targetDepth !== undefined) pref.targetDepth = targetDepth;
  const depthWeight = optFloat(q, "depthWeight");
  if (depthWeight !== undefined) pref.depthWeight = depthWeight;
  const centralityWeight = optFloat(q, "centralityWeight");
  if (centralityWeight !== undefined) pref.centralityWeight = centralityWeight;
  const avoidPaired = optBool(q, "avoidPaired");
  if (avoidPaired !== undefined) pref.avoidPaired = avoidPaired;

  const allowed = optStr(q, "allowedAreaKinds");
  if (allowed !== undefined) {
    const kinds = csv(allowed);
    const valid = new Set<string>(AREA_KINDS as string[]);
    const bad = kinds.filter((k) => !valid.has(k));
    if (bad.length > 0) throw new HttpError(400, `invalid allowedAreaKinds: ${bad.join(",")}`);
    pref.allowedAreaKinds = kinds as SeatPreference["allowedAreaKinds"];
  }
  return pref;
}

// --- Concurrency-limited map ------------------------------------------------

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
  const pool = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(pool);
  return results;
}

// --- DB-backed "Seats Together" reads (/together, /catalog) -----------------

/** Snake_case projection of a `sessions` row (date + timestamps cast to text/ISO in SQL). */
interface SessionRow {
  id: string;
  chain: string;
  movie_id: string;
  movie_name: string | null;
  cinema_id: string;
  cinema_name: string | null;
  date: string;
  start_time: string | null;
  format: string | null;
  screen: string | null;
  seats_available: number | null;
  booking_url: string | null;
  seat_allocation: boolean | null;
  fetched_at: string;
}

interface SeatRow {
  session_id: string;
  seat_id: string;
  row_label: string | null;
  row: number;
  col: number;
  score: number;
}

/** Camel-case session metadata returned in /together results. */
function mapSession(r: SessionRow) {
  return {
    id: r.id,
    chain: r.chain,
    movieId: r.movie_id,
    movieName: r.movie_name,
    cinemaId: r.cinema_id,
    cinemaName: r.cinema_name,
    date: r.date,
    startTime: r.start_time,
    format: r.format,
    screen: r.screen,
    seatsAvailable: r.seats_available,
    bookingUrl: r.booking_url,
    seatAllocation: r.seat_allocation,
  };
}

/**
 * Build the parameterised WHERE clause for the session filter. chain is required; movieId, cinemaIds,
 * dateFrom, dateTo are optional. Every user value is a bound parameter ($n) — column names are static
 * literals, so there is no injection surface.
 */
/**
 * Australia/Sydney calendar date "YYYY-MM-DD" for a true UTC instant. Session showtimes are local
 * wall-time mislabelled with a trailing `Z` (the fake-`Z` path), so /together compares the `date`
 * column / YYYY-MM-DD prefix by SUBSTRING and never UTC-parses `start_time`.
 */
function sydneyDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function buildSessionFilter(opts: {
  chain: string;
  movieId?: string;
  cinemaIds?: string[];
  dateFrom?: string;
  dateTo?: string;
}): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    clauses.push(sql.replace("$?", `$${params.length}`));
  };

  add("chain = $?", opts.chain);
  if (opts.movieId !== undefined) add("movie_id = $?", opts.movieId);
  if (opts.cinemaIds && opts.cinemaIds.length > 0) add("cinema_id = ANY($?::text[])", opts.cinemaIds);
  if (opts.dateFrom !== undefined) add("date >= $?", opts.dateFrom);
  if (opts.dateTo !== undefined) add("date <= $?", opts.dateTo);

  return { where: clauses.join(" AND "), params };
}

// --- P30.3 (C7) /together freshness metadata --------------------------------

type CoverageState = "cached" | "not_cached" | "stale";

interface Freshness {
  oldestFetchedAt: string | null;
  newestFetchedAt: string | null;
  lastSuccessfulIngestAt: string | null;
  coverage: Record<string, CoverageState>;
}

const DEFAULT_FRESHNESS_STALE_MS = 2 * 60 * 60_000; // 2h, override via TOGETHER_FRESHNESS_STALE_MS

/** Staleness threshold (ms) from env, defaulting to 2h. Read per-request (cheap, env-overridable). */
function freshnessStaleMs(): number {
  const raw = Number(process.env.TOGETHER_FRESHNESS_STALE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_FRESHNESS_STALE_MS;
}

/**
 * Build the additive `/together` freshness object from the SAME live result set plus the global
 * refresh ledger. oldest/newest = min/max fetched_at over the live rows (true-UTC ISO; null when the
 * live set is empty). lastSuccessfulIngestAt = newest refresh_runs row with outcome='ok' (finished_at,
 * fallback started_at), global. coverage enumerates ONLY the requested chain: not_cached unless the
 * chain has an enabled watch AND a successful ingest exists; stale when cached but the oldest live
 * fetched_at has aged past the threshold; cached otherwise (including cached-but-no-result).
 */
async function computeFreshness(
  db: Pool,
  chain: string,
  liveRows: SessionRow[],
  now: Date,
): Promise<Freshness> {
  // min/max over the live set. fetched_at strings are uniform true-UTC ISO, so lexicographic
  // comparison is chronological — no parsing needed for the min/max selection itself.
  let oldestFetchedAt: string | null = null;
  let newestFetchedAt: string | null = null;
  for (const r of liveRows) {
    if (oldestFetchedAt === null || r.fetched_at < oldestFetchedAt) oldestFetchedAt = r.fetched_at;
    if (newestFetchedAt === null || r.fetched_at > newestFetchedAt) newestFetchedAt = r.fetched_at;
  }

  // lastSuccessfulIngestAt: latest ok refresh_runs row, finished_at falling back to started_at.
  // refresh_runs has no chain column, so this is GLOBAL across chains.
  const ingestRes = await db.query<{ ts: string }>(
    `SELECT to_char(COALESCE(finished_at, started_at) AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ts
       FROM refresh_runs
      WHERE outcome = 'ok'
      ORDER BY COALESCE(finished_at, started_at) DESC
      LIMIT 1`,
  );
  const lastSuccessfulIngestAt = ingestRes.rows[0]?.ts ?? null;

  // cached requires an enabled watch for the chain AND at least one successful ingest (global ledger).
  const watchRes = await db.query(
    `SELECT 1 FROM watches WHERE chain = $1 AND enabled = true LIMIT 1`,
    [chain],
  );
  const hasEnabledWatch = watchRes.rows.length > 0;

  let coverageState: CoverageState;
  if (!hasEnabledWatch || lastSuccessfulIngestAt === null) {
    coverageState = "not_cached";
  } else if (
    oldestFetchedAt !== null &&
    now.getTime() - Date.parse(oldestFetchedAt) > freshnessStaleMs()
  ) {
    coverageState = "stale";
  } else {
    coverageState = "cached";
  }

  return {
    oldestFetchedAt,
    newestFetchedAt,
    lastSuccessfulIngestAt,
    coverage: { [chain]: coverageState },
  };
}

// --- Server -----------------------------------------------------------------

export interface BuildServerOptions {
  /** Override/extend the chain adapter registry (e.g. inject a stub in tests). */
  adapters?: AdapterRegistry;
  /**
   * Postgres pool backing /together + /catalog (the cached "Seats Together" reads). When omitted,
   * those two endpoints respond 503; the live endpoints (/seatmap etc.) never touch it.
   */
  pool?: Pool;
  /** Session-listing cache TTL in milliseconds. Default 5 minutes. */
  sessionCacheTtlMs?: number;
  /** Concurrency for seat-map fetches in /best. Default 4. */
  bestConcurrency?: number;
  /** Default number of top seats returned per session by /best. Clamped to 1..20. Default 5. */
  bestTopN?: number;
  /**
   * Max candidate sessions /best will fan out seat-map fetches for, after sorting by
   * `seatsAvailable` desc. Per-request `?maxSessions=` can lower this cap. Default 40.
   */
  maxSessions?: number;
  /**
   * Per-IP rate limit. `false` disables it (e.g. in tests). When omitted, a default of
   * 120 requests/minute applies, overridable via env (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`).
   */
  rateLimit?: false | { max: number; windowMs: number };
  /** Forwarded to Fastify (e.g. `{ logger: false }`). */
  logger?: boolean;
}

/** Resolve the effective rate-limit config from opts then env, defaulting to 120/min. */
function resolveRateLimit(opt: BuildServerOptions["rateLimit"]): { max: number; windowMs: number } | false {
  if (opt === false) return false;
  if (opt) return opt;
  const max = Number(process.env.RATE_LIMIT_MAX);
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS);
  return {
    max: Number.isFinite(max) && max > 0 ? max : 120,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000,
  };
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const adapters: AdapterRegistry = { ...defaultAdapters(), ...(opts.adapters ?? {}) };
  const sessionCache = new TtlCache<Session[]>(opts.sessionCacheTtlMs ?? 5 * 60_000);
  const bestConcurrency = opts.bestConcurrency ?? 4;
  const bestTopN = clampInt(opts.bestTopN ?? 5, 1, MAX_BEST_TOP_N);
  const maxSessions = clampInt(opts.maxSessions ?? 40, 1, Number.MAX_SAFE_INTEGER);
  const pool = opts.pool;

  /** The DB-backed endpoints require a pool; absent one is a 503 (db not wired/up). */
  const requirePool = (): Pool => {
    if (!pool) throw new HttpError(503, "database not configured");
    return pool;
  };

  // Production traffic reaches Fastify through one Caddy hop on the Docker network.
  // Keep the API port private when relying on X-Forwarded-For for per-client limits.
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: 1 });

  // Per-IP rate limit (configurable; disabled when `rateLimit === false`). The plugin THROWS the
  // result of errorResponseBuilder, so we return an Error carrying statusCode 429 and let the
  // central error handler render the standard `{error}` shape.
  const rl = resolveRateLimit(opts.rateLimit);
  if (rl !== false) {
    void app.register(rateLimit, {
      global: true,
      max: rl.max,
      timeWindow: rl.windowMs,
      errorResponseBuilder: (_req, ctx) => {
        const err = new Error("rate limit exceeded") as Error & { statusCode?: number };
        err.statusCode = ctx.statusCode; // 429
        return err;
      },
    });
  }

  // Centralised JSON error shape.
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof UpstreamError) {
      // Upstream chain failure: 503 when the chain timed out, 502 otherwise.
      reply.status(err.kind === "timeout" ? 503 : 502).send({ error: err.message });
      return;
    }
    const status = err instanceof HttpError ? err.statusCode : (err.statusCode ?? 500);
    reply.status(status).send({ error: err.message });
  });
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: "not found" });
  });

  // Routes live in a child plugin registered AFTER @fastify/rate-limit so the plugin's global
  // onRequest hook is in place before the routes are defined (Fastify applies hooks by load order).
  void app.register(async (app: FastifyInstance) => {
    app.get("/healthz", async () => ({ ok: true }));

  app.get("/cinemas", async (req: FastifyRequest) => {
    const q = req.query as Query;
    const adapter = resolveAdapter(adapters, q.chain);
    return adapter.listCinemas();
  });

  app.get("/movies", async (req: FastifyRequest) => {
    const q = req.query as Query;
    const adapter = resolveAdapter(adapters, q.chain);
    const cinemaIds = csv(reqStr(q, "cinemaIds"));
    if (cinemaIds.length === 0) throw new HttpError(400, "missing required query param: cinemaIds");
    const date = reqStr(q, "date");

    // Empty movieId = all movies at the cinema/date; dedupe to distinct movies.
    const sessions = await adapter.listSessions({ movieId: "", cinemaIds, date });
    const byId = new Map<string, { id: string; name: string }>();
    for (const s of sessions) {
      if (!byId.has(s.movieId)) byId.set(s.movieId, { id: s.movieId, name: s.movieName });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  app.get("/sessions", async (req: FastifyRequest) => {
    const q = req.query as Query;
    const adapter = resolveAdapter(adapters, q.chain);
    const movieId = reqStr(q, "movieId");
    const cinemaIds = csv(reqStr(q, "cinemaIds"));
    if (cinemaIds.length === 0) throw new HttpError(400, "missing required query param: cinemaIds");
    const date = reqStr(q, "date");

    const key = `${adapter.chain}|${movieId}|${cinemaIds.join(",")}|${date}`;
    const cached = sessionCache.get(key);
    if (cached) return cached;
    const sessions = await adapter.listSessions({ movieId, cinemaIds, date });
    sessionCache.set(key, sessions);
    return sessions;
  });

  app.get("/seatmap", async (req: FastifyRequest) => {
    const q = req.query as Query;
    const adapter = resolveAdapter(adapters, q.chain);
    const sessionId = reqStr(q, "sessionId");
    const pref = parsePreference(q);

    const map = await adapter.getSeatMap(sessionId);
    const scored = scoreAvailableSeats(map, pref);

    // Back-compat: when the `party` KEY is absent the response is byte-identical to before (no live
    // block keys). Presence is the trigger, not parseability — a present-but-malformed `party`
    // (party=abc, party=) recomputes with the /together default (2), rather than silently dropping
    // to the legacy shape (which would diverge from /together's parsing).
    if ((q as Record<string, unknown>).party === undefined) {
      return { ...map, scored };
    }

    // `party` present → recompute live adjacency over the SAME scored seats, mirroring /together.
    const party = Math.max(1, optInt(q, "party") ?? 2);
    const minScore = optInt(q, "minScore") ?? 74;
    const blockSeats: BlockSeat[] = scored.map((s) => ({
      id: s.seat.id,
      rowLabel: s.seat.rowLabel ?? "",
      row: s.seat.row,
      col: s.seat.col,
      score: s.score,
    }));
    const blocks = findAdjacentBlocks(blockSeats, { minScore, size: party });
    return { ...map, scored, blocks, block: blocks[0] ?? null, party, minScore };
  });

  app.get("/best", async (req: FastifyRequest) => {
    const q = req.query as Query;
    const adapter = resolveAdapter(adapters, q.chain);
    const movieId = reqStr(q, "movieId");
    const cinemaIds = csv(reqStr(q, "cinemaIds"));
    if (cinemaIds.length === 0) throw new HttpError(400, "missing required query param: cinemaIds");
    const date = reqStr(q, "date");
    const pref = parsePreference(q);
    const topN = clampInt(optInt(q, "topN") ?? bestTopN, 1, MAX_BEST_TOP_N);
    const requestedMaxSessions = optPositiveInt(q, "maxSessions");
    const cap = Math.min(maxSessions, requestedMaxSessions ?? maxSessions);

    const sessions = await adapter.listSessions({ movieId, cinemaIds, date });

    // Sessions without seat allocation have no seat map to score - note and skip.
    const skipped: Array<{ sessionId: string; reason: string }> = sessions
      .filter((s) => !s.seatAllocation)
      .map((s) => ({ sessionId: s.id, reason: "seatAllocation=false" }));

    // Cap the seat-map fan-out so a huge candidate set can't blow up the request. Sort by
    // live availability (most seats first; unknown availability last) so the cap keeps the
    // most promising sessions, and report the drop count so truncation is never silent.
    const candidates = sessions
      .filter((s) => s.seatAllocation)
      .sort((a, b) => (b.seatsAvailable ?? -1) - (a.seatsAvailable ?? -1));
    const allocatable = candidates.slice(0, cap);
    const droppedSessions = candidates.length - allocatable.length;

    type BestScoredSession = {
      session: Session;
      bestScore: number;
      bookingUrl: string;
      topSeats: ScoredSeat[];
    };
    type SeatMapError = { sessionId: string; error: string };
    type SeatMapOutcome =
      | { scored: BestScoredSession }
      | { skipped: { sessionId: string; reason: string }; error: SeatMapError };

    const outcomes = await mapWithConcurrency(allocatable, bestConcurrency, async (session): Promise<SeatMapOutcome> => {
      try {
        const map = await adapter.getSeatMap(session.id, { preview: true });
        const ranked = rankSeats(map, pref);
        return {
          scored: {
            session,
            bestScore: bestSeatScore(map, pref),
            bookingUrl: session.bookingUrl,
            topSeats: ranked.slice(0, topN),
          },
        };
      } catch (err) {
        const message = errorMessage(err);
        return {
          skipped: { sessionId: session.id, reason: `seat map failed: ${message}` },
          error: { sessionId: session.id, error: message },
        };
      }
    });
    const scored: BestScoredSession[] = [];
    const errors: SeatMapError[] = [];
    for (const outcome of outcomes) {
      if ("scored" in outcome) {
        scored.push(outcome.scored);
      } else {
        skipped.push(outcome.skipped);
        errors.push(outcome.error);
      }
    }

    scored.sort((a, b) => b.bestScore - a.bestScore);
    return {
      sessions: scored,
      skipped,
      consideredSessions: allocatable.length,
      droppedSessions,
      errors,
    };
    });

  // --- DB-backed cache reads (NO upstream) ---------------------------------

  // GET /together — sessions with `party` adjacent in-zone seats, ranked best-first. Pure DB read.
  app.get("/together", async (req: FastifyRequest) => {
    const q = req.query as Query;
    const chain = reqStr(q, "chain"); // 400 before any DB touch when missing
    resolveAdapter(adapters, chain); // 400 on unknown chain (registry lookup only — no upstream call)
    const db = requirePool(); // 503 when the pool is not configured

    const movieId = optStr(q, "movieId");
    const cinemaIds = (() => {
      const raw = optStr(q, "cinemaIds");
      return raw === undefined ? undefined : csv(raw);
    })();
    const dateFrom = optStr(q, "dateFrom");
    const dateTo = optStr(q, "dateTo");
    const party = Math.max(1, optInt(q, "party") ?? 2);
    const minScore = optInt(q, "minScore") ?? 74;

    const now = new Date();
    const { where, params } = buildSessionFilter({ chain, movieId, cinemaIds, dateFrom, dateTo });
    // P30.2 (C6) liveness: hide tombstoned rows and past-date sessions. Past is by Sydney-local
    // fake-Z wall-date (the `date` column / YYYY-MM-DD prefix), NEVER by UTC-parsing start_time —
    // a yesterday 23:30Z showtime is still "yesterday" even though UTC would map it into today.
    params.push(sydneyDate(now));
    const liveWhere = `${where} AND disappeared_at IS NULL AND date >= $${params.length}`;
    const sessionsRes = await db.query<SessionRow>(
      `SELECT id, chain, movie_id, movie_name, cinema_id, cinema_name,
              date::text AS date,
              to_char(start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS start_time,
              format, screen, seats_available, booking_url, seat_allocation,
              to_char(fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fetched_at
         FROM sessions
        WHERE ${liveWhere}`,
      params,
    );
    const sessions = sessionsRes.rows;

    // P30.3 (C7) freshness: additive top-level object. NEVER alters count/results or the P30.2
    // liveness filter — computed from the SAME live `sessions` set plus the refresh_runs ledger.
    const freshness = await computeFreshness(db, chain, sessions, now);
    if (sessions.length === 0) return { party, minScore, count: 0, results: [], freshness };

    const ids = sessions.map((s) => s.id);
    const seatsRes = await db.query<SeatRow>(
      `SELECT session_id, seat_id, row_label, row, col, score
         FROM session_seats
        WHERE session_id = ANY($1::text[])`,
      [ids],
    );
    const seatsBySession = new Map<string, BlockSeat[]>();
    for (const s of seatsRes.rows) {
      let arr = seatsBySession.get(s.session_id);
      if (!arr) {
        arr = [];
        seatsBySession.set(s.session_id, arr);
      }
      arr.push({ id: s.seat_id, rowLabel: s.row_label ?? "", row: s.row, col: s.col, score: s.score });
    }

    type Block = ReturnType<typeof findAdjacentBlocks>[number];
    type Result = {
      session: ReturnType<typeof mapSession>;
      block: Block | null;
      approximateAdjacency: boolean;
      fetchedAt: string;
      _start: string | null;
    };
    // #39: every matched session is returned. A session with no qualifying adjacency block
    // (party too large, all seats below minScore, a column gap, or zero available seats =
    // sold out) is returned with block:null so the matrix can show "sold" vs "—" (absent row).
    const results: Result[] = [];
    for (const row of sessions) {
      const seats = seatsBySession.get(row.id) ?? [];
      const block = findAdjacentBlocks(seats, { minScore, size: party })[0] ?? null;
      results.push({
        session: mapSession(row),
        block,
        approximateAdjacency: row.chain === "hoyts",
        fetchedAt: row.fetched_at,
        _start: row.start_time,
      });
    }

    // Rank: best-block avgScore DESC (blockless last), then earliest startTime ASC (nulls last),
    // then session id ASC.
    results.sort((a, b) => {
      const av = a.block ? a.block.avgScore : Number.NEGATIVE_INFINITY;
      const bv = b.block ? b.block.avgScore : Number.NEGATIVE_INFINITY;
      if (bv !== av) return bv - av;
      const sa = a._start;
      const sb = b._start;
      if (sa !== sb) {
        if (sa === null) return 1;
        if (sb === null) return -1;
        return sa < sb ? -1 : 1;
      }
      return a.session.id < b.session.id ? -1 : a.session.id > b.session.id ? 1 : 0;
    });

    return {
      party,
      minScore,
      count: results.length,
      results: results.map(({ session, block, approximateAdjacency, fetchedAt }) => ({
        session,
        block,
        approximateAdjacency,
        fetchedAt,
      })),
      freshness,
    };
  });

  // GET /catalog — distinct movies / cinemas / dates in the cache, to populate the web pickers.
  app.get("/catalog", async (req: FastifyRequest) => {
    const q = req.query as Query;
    const db = requirePool();
    const chain = optStr(q, "chain");
    const where = chain !== undefined ? "WHERE chain = $1" : "";
    const params = chain !== undefined ? [chain] : [];

    // Distinct by (chain, movie_id) / (chain, cinema_id) per contract — NOT by (id,name,chain), so a
    // name that drifts for the same id across cached rows still collapses to one entry. DISTINCT ON
    // picks one deterministic name per key (lowest non-null name), then the outer query sorts by name,id.
    const movies = await db.query<{ id: string; name: string | null; chain: string }>(
      `SELECT id, name, chain FROM (
         SELECT DISTINCT ON (chain, movie_id) movie_id AS id, movie_name AS name, chain
           FROM sessions ${where}
          ORDER BY chain, movie_id, movie_name NULLS LAST
       ) m
        ORDER BY name NULLS LAST, id`,
      params,
    );
    const cinemas = await db.query<{ id: string; name: string | null; chain: string }>(
      `SELECT id, name, chain FROM (
         SELECT DISTINCT ON (chain, cinema_id) cinema_id AS id, cinema_name AS name, chain
           FROM sessions ${where}
          ORDER BY chain, cinema_id, cinema_name NULLS LAST
       ) c
        ORDER BY name NULLS LAST, id`,
      params,
    );
    const dates = await db.query<{ date: string }>(
      `SELECT DISTINCT date::text AS date FROM sessions ${where} ORDER BY date`,
      params,
    );

    return {
      movies: movies.rows,
      cinemas: cinemas.rows,
      dates: dates.rows.map((r) => r.date),
    };
  });
  });

  return app;
}

// --- Entrypoint -------------------------------------------------------------

async function start(): Promise<void> {
  const port = Number(process.env.PORT) || 3001;
  // Wire the cache pool from DATABASE_URL when present; absent it, /together + /catalog return 503
  // and the live endpoints still work.
  const pool = createPoolFromEnv();
  const app = buildServer({ logger: true, pool });
  try {
    await app.listen({ port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err as Error);
    process.exit(1);
  }
}

// Only bind a port when run directly (`node dist/index.js`), not when imported by tests.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void start();
}
