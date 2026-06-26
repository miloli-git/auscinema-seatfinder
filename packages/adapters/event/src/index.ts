import type {
  ChainAdapter,
  SessionQuery,
  Cinema,
  Session,
  SeatMap,
  SeatArea,
  Seat,
  SeatStatus,
  ScreenFormat,
} from "@auscinema/core";
import { UpstreamError, isAbortError } from "@auscinema/core";
import { readFileSync } from "node:fs";

/** Injectable HTTP-JSON fetcher so parsing can run against fixtures without network. */
export type FetchJson = (url: string) => Promise<unknown>;

/**
 * Dated AU cinema reference. Event's `/api/cinemas/JsonLd` feed is dead (empty `@graph`); the
 * live list exists only in the `/Cinemas` page HTML. We bundle a dated snapshot
 * (`data/cinemas.au.json`, see its `capturedAt`) and serve it - deterministic, no network.
 * Refresh by re-running the capture. Resolved relative to the compiled module (dist → ../data).
 */
const CINEMAS_REF_URL = new URL("../data/cinemas.au.json", import.meta.url);

/**
 * Event Cinemas adapter - the reference implementation.
 *
 * Backend (reverse-engineered, no auth, send a browser UA + `X-Requested-With: XMLHttpRequest`):
 *   - GET /Cinemas/GetSessions?cinemaIds=58&movieId=19797&date=2026-07-21
 *       -> { Success, Data: { Movies:[ { Id, Name, CinemaModels:[ { Id, Name, Sessions:[ {Id,StartTime,...} ] } ] } ] } }
 *   - GET /Ticketing/Order/GetSeating?sessionId=15433720
 *       -> { Success, Data: { Seats:{ Rows:[ {RowName, Seats:[ {SeatId,SeatName,Status,AreaId,...} ]} ] }, Areas:[...] } }
 *   - Cinemas: served from a bundled dated snapshot (data/cinemas.au.json) - the live
 *     /api/cinemas/JsonLd feed is dead (empty @graph); the real list is only in /Cinemas HTML.
 *
 * SeatId encodes physical geometry as "area|type|ROW|COLUMN" - the last two ints are the grid
 * coordinates that normalise into Seat.row / Seat.col. See docs/endpoints.md.
 */
export class EventCinemasAdapter implements ChainAdapter {
  readonly chain = "event" as const;
  private readonly base = "https://www.eventcinemas.com.au";
  private readonly fetchJson: FetchJson;

  constructor(opts?: { fetchJson?: FetchJson }) {
    this.fetchJson = opts?.fetchJson ?? defaultFetchJson;
  }

  async listCinemas(): Promise<Cinema[]> {
    return loadBundledCinemas();
  }

  async listSessions(query: SessionQuery): Promise<Session[]> {
    // C8: one request PER cinemaId (Event's GetSessions returns 0 for a comma-joined cinemaIds),
    // then merge the per-cinema responses and dedupe by Session.id. Empty cinemaIds -> no requests.
    // If any per-cinema request rejects, Promise.all propagates it (no partial result) - matches the
    // existing Event/Hoyts/Reading convention.
    const perCinema = await Promise.all(
      query.cinemaIds.map((cinemaId) => {
        const url =
          `${this.base}/Cinemas/GetSessions?cinemaIds=${encodeURIComponent(cinemaId)}` +
          `&movieId=${encodeURIComponent(query.movieId)}&date=${encodeURIComponent(query.date)}`;
        return this.fetchJson(url).then(parseSessions);
      }),
    );

    const byId = new Map<string, Session>();
    for (const sessions of perCinema) {
      for (const s of sessions) {
        if (!byId.has(s.id)) byId.set(s.id, s);
      }
    }
    const merged = [...byId.values()];

    // Event's GetSessions IGNORES the movieId param - it returns every movie playing at the
    // cinema/date. Filter to the requested movie client-side (empty movieId = all movies).
    const want = query.movieId.trim();
    return want ? merged.filter((s) => s.movieId === want) : merged;
  }

  async getSeatMap(sessionId: string, _opts?: { preview?: boolean }): Promise<SeatMap> {
    const url = `${this.base}/Ticketing/Order/GetSeating?sessionId=${encodeURIComponent(sessionId)}`;
    const raw = await this.fetchJson(url);
    return parseSeatMap(sessionId, raw);
  }
}

// --- HTTP -------------------------------------------------------------------

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
  Accept: "application/json",
};

/** Real network call: 15s timeout, one retry on retryable network/timeout failure. */
const defaultFetchJson: FetchJson = async (url) => {
  const attempt = async (): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal });
      if (!res.ok) {
        throw new UpstreamError(`Event request failed: ${res.status} ${res.statusText} (${url})`, {
          kind: "http",
          status: res.status,
        });
      }
      try {
        return await res.json();
      } catch (err) {
        throw new UpstreamError(`Event response was not valid JSON (${url})`, {
          kind: "parse",
          cause: err,
        });
      }
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      if (isAbortError(err)) {
        throw new UpstreamError(`Event request timed out (${url})`, { kind: "timeout", cause: err });
      }
      throw err; // raw network error retried below, then normalised
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await attempt();
  } catch (err) {
    if (!isRetryable(err)) throw err;
    // One retry on retryable network/timeout failure (cheap, idempotent GET).
    try {
      return await attempt();
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      throw new UpstreamError(`Event request failed (${url})`, { kind: "unknown", cause: err });
    }
  }
};

function isRetryable(err: unknown): boolean {
  return err instanceof UpstreamError ? err.kind === "timeout" : true;
}

// --- Parsing ----------------------------------------------------------------

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

function mapFormat(screenType: unknown, screenTypeName: unknown): ScreenFormat {
  const raw = str(screenTypeName) || str(screenType) || "";
  const k = raw.toLowerCase().replace(/[\s-]/g, "");
  let kind: ScreenFormat["kind"];
  if (k.includes("vmax")) kind = "vmax";
  else if (k.includes("goldclass")) kind = "goldclass";
  else if (k.includes("imax")) kind = "imax";
  else if (k.includes("standard")) kind = "standard";
  else kind = "other";
  return { kind, raw };
}

function parseSessions(raw: unknown): Session[] {
  const data = isObj(raw) && isObj(raw.Data) ? raw.Data : undefined;
  if (!data) return [];
  const out: Session[] = [];
  for (const movie of arr(data.Movies)) {
    if (!isObj(movie)) continue;
    const movieId = String(num(movie.Id) ?? str(movie.Id) ?? "");
    const movieName = str(movie.Name) ?? "";
    for (const cm of arr(movie.CinemaModels)) {
      if (!isObj(cm)) continue;
      const cinemaId = String(num(cm.Id) ?? str(cm.Id) ?? "");
      const cinemaName = str(cm.Name) ?? "";
      for (const s of arr(cm.Sessions)) {
        if (!isObj(s)) continue;
        // Raw Attributes are objects; core wants attribute *codes* (string[]). Map Attributes[].Code.
        const attributes = arr(s.Attributes)
          .map((a) => (isObj(a) ? str(a.Code) : undefined))
          .filter((c): c is string => !!c);
        out.push({
          chain: "event",
          id: String(num(s.Id) ?? str(s.Id) ?? ""),
          movieId: movieId || String(num(s.MovieId) ?? ""),
          movieName,
          cinemaId: cinemaId || String(num(s.CinemaId) ?? ""),
          cinemaName,
          startTime: str(s.StartTime) ?? "",
          format: mapFormat(s.ScreenType, s.ScreenTypeName),
          screenName: str(s.ScreenName),
          seatsAvailable: num(s.SeatsAvailable),
          seatAllocation: s.SeatAllocation === true,
          bookingUrl: str(s.BookingUrl) ?? "",
          attributes,
        });
      }
    }
  }
  return out;
}

function mapAreaKind(code: unknown, name: unknown): SeatArea["kind"] {
  const c = (str(code) ?? "").toLowerCase();
  const n = (str(name) ?? "").toLowerCase();
  if (c.includes("club") || n.includes("recliner")) return "recliner";
  if (c.includes("suite") || n.includes("daybed")) return "daybed";
  if (n.includes("platinum")) return "premium";
  if (n.includes("gold")) return "goldclass";
  if (n.includes("companion")) return "companion";
  if (n.includes("standard")) return "standard";
  return "other";
}

function mapStatus(status: unknown): SeatStatus {
  switch (str(status)) {
    case "Available":
      return "available";
    case "Sold":
      return "sold";
    case "Spacer":
      return "spacer";
    case "Companion":
      return "companion";
    case "Special":
      return "special";
    default:
      return "unavailable";
  }
}

function parseSeatMap(sessionId: string, raw: unknown): SeatMap {
  const data = isObj(raw) && isObj(raw.Data) ? raw.Data : undefined;
  const areas: SeatArea[] = arr(data?.Areas)
    .filter(isObj)
    .map((a) => ({
      id: String(num(a.Id) ?? str(a.Id) ?? ""),
      name: str(a.Name) ?? "",
      code: str(a.Code),
      kind: mapAreaKind(a.Code, a.Name),
    }));

  const seats: Seat[] = [];
  const seatsRoot = isObj(data?.Seats) ? data.Seats : undefined;
  for (const row of arr(seatsRoot?.Rows)) {
    if (!isObj(row)) continue;
    const rowLabel = str(row.RowName) ?? "";
    for (const s of arr(row.Seats)) {
      if (!isObj(s)) continue;
      const id = str(s.SeatId) ?? "";
      // SeatId = "{area}|{type}|{ROW}|{COLUMN}". Decode physical grid from fields 2 and 3.
      const fields = id.split("|");
      const physRow = Number.parseInt(fields[2] ?? "", 10);
      const physCol = Number.parseInt(fields[3] ?? "", 10);
      // Row mapping: core requires HIGHER row = further back. Verified against fixture
      // getseating.session-15433720.json: row "A" (front) encodes physRow 11, and physRow
      // DECREASES toward the back (B=10, C=9, ... K=1). Event's physRow therefore runs
      // front->back DESCENDING, so negate it (row=-physRow): "A" gets the smallest core row
      // (-11, front) and "K" the largest (-1, back).
      // Col mapping: Event lists columns DECREASING left->right (row A: 20,19,...,1), so
      // col=-physCol makes col increase left->right per the core contract.
      const rowCoord = Number.isFinite(physRow) ? -physRow : 0;
      const colCoord = Number.isFinite(physCol) ? -physCol : 0;
      seats.push({
        id,
        name: str(s.SeatName),
        rowLabel,
        row: rowCoord,
        col: colCoord,
        status: mapStatus(s.Status),
        areaId: String(num(s.AreaId) ?? str(s.AreaId) ?? ""),
        paired: s.CoupleSeat === true,
        premium: s.IsPlatinum === true,
        accessible: s.Wheelchair === true,
      });
    }
  }

  return {
    chain: "event",
    sessionId,
    screenName: str(data?.ScreenName),
    areas,
    seats,
  };
}

/** Load + normalise the bundled dated AU cinema reference into core `Cinema[]`. */
function loadBundledCinemas(): Cinema[] {
  const doc = JSON.parse(readFileSync(CINEMAS_REF_URL, "utf8")) as {
    cinemas?: Array<{ id?: unknown; name?: unknown; url?: unknown }>;
  };
  const out: Cinema[] = [];
  for (const c of doc.cinemas ?? []) {
    const id = str(c.id) ?? (num(c.id) !== undefined ? String(num(c.id)) : "");
    const name = str(c.name) ?? "";
    if (!id || !name) continue;
    const url = str(c.url);
    out.push({ chain: "event", id, name, ...(url ? { url } : {}) });
  }
  return out;
}
