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
  bestSeatScore,
  UpstreamError,
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

// --- Server -----------------------------------------------------------------

export interface BuildServerOptions {
  /** Override/extend the chain adapter registry (e.g. inject a stub in tests). */
  adapters?: AdapterRegistry;
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
    const scored = rankSeats(map, pref);
    return { ...map, scored };
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
  });

  return app;
}

// --- Entrypoint -------------------------------------------------------------

async function start(): Promise<void> {
  const port = Number(process.env.PORT) || 3001;
  const app = buildServer({ logger: true });
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
