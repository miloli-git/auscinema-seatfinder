/**
 * API service — thin Fastify front for the chain adapters and the seat scorer.
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
import {
  rankSeats,
  bestSeatScore,
  type Chain,
  type ChainAdapter,
  type SeatPreference,
  type Session,
} from "@auscinema/core";
import { EventCinemasAdapter } from "@auscinema/adapter-event";

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

/** Default registry — only `event` is wired today; hoyts/reading/village slot in later. */
function defaultAdapters(): AdapterRegistry {
  return { event: new EventCinemasAdapter() };
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

function optBool(q: Query, key: string): boolean | undefined {
  const raw = optStr(q, key);
  if (raw === undefined) return undefined;
  return raw === "true" || raw === "1" || raw === "yes";
}

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
  /** Default number of top seats returned per session by /best. Default 5. */
  bestTopN?: number;
  /** Forwarded to Fastify (e.g. `{ logger: false }`). */
  logger?: boolean;
}

export function buildServer(opts: BuildServerOptions = {}): FastifyInstance {
  const adapters: AdapterRegistry = { ...defaultAdapters(), ...(opts.adapters ?? {}) };
  const sessionCache = new TtlCache<Session[]>(opts.sessionCacheTtlMs ?? 5 * 60_000);
  const bestConcurrency = opts.bestConcurrency ?? 4;
  const bestTopN = opts.bestTopN ?? 5;

  const app = Fastify({ logger: opts.logger ?? false });

  // Centralised JSON error shape.
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err instanceof HttpError ? err.statusCode : (err.statusCode ?? 500);
    reply.status(status).send({ error: err.message });
  });
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: "not found" });
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/cinemas", async (req: FastifyRequest) => {
    const q = req.query as Query;
    const adapter = resolveAdapter(adapters, q.chain);
    return adapter.listCinemas();
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
    const topN = optFloat(q, "topN") ?? bestTopN;

    const sessions = await adapter.listSessions({ movieId, cinemaIds, date });

    // Sessions without seat allocation have no seat map to score — note and skip.
    const skipped = sessions
      .filter((s) => !s.seatAllocation)
      .map((s) => ({ sessionId: s.id, reason: "seatAllocation=false" }));
    const allocatable = sessions.filter((s) => s.seatAllocation);

    const scored = await mapWithConcurrency(allocatable, bestConcurrency, async (session) => {
      const map = await adapter.getSeatMap(session.id, { preview: true });
      const ranked = rankSeats(map, pref);
      return {
        session,
        bestScore: bestSeatScore(map, pref),
        bookingUrl: session.bookingUrl,
        topSeats: ranked.slice(0, topN),
      };
    });

    scored.sort((a, b) => b.bestScore - a.bestScore);
    return { sessions: scored, skipped };
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
