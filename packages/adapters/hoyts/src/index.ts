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

/** Injectable HTTP-JSON fetcher so parsing can run against fixtures without network. */
export type FetchJson = (url: string) => Promise<unknown>;

/** Per-vistaId join data from the movies list: title (#72) + optional poster artwork. */
export type MovieMeta = { name: string; posterUrl?: string };

/**
 * Hoyts Cinemas adapter - reverse-engineered, open JSON API (no auth/subscription key).
 *
 * The hoyts.com.au Vue SPA reads its base URLs from an embedded `config.urls` object and calls
 * Azure APIM services with a plain browser `User-Agent` + `Accept: application/json`. No
 * `Ocp-Apim-Subscription-Key` is required for the read endpoints below.
 *
 * Bases:
 *   - webApi (cinema/movies/sessions) : https://apim-aea.hoyts.com.au/cinemaapi-au-live/api/
 *   - ticketingApi (seat maps)        : https://apim-aea.hoyts.com.au/ticketing-au-live/api/v1/
 *
 * Routes:
 *   - GET cinemaapi/cinemas
 *       -> [ { id:"MIDCIN", slug, name, state, link, features:[...], address:{...}, ... } ]
 *   - GET cinemaapi/movies
 *       -> [ { id, vistaId:"HO00008574"(=session movieId), slug, name, ... } ]
 *     #72: joined into sessions by `vistaId` to resolve the title the sessions feed omits.
 *     `vistaId` is occasionally comma-joined ("HO00010000,HO00011219") when one marketing entry
 *     covers two Vista ids (live-verified: 13 concurrent examples, e.g. "Spider-Man: Brand New
 *     Day", "Moana", "Toy Story 5" - all real major current releases); parseMovieMeta() splits
 *     it so every id in the list resolves, not just the joined string as a whole. Entries also
 *     carry a relative `posterImage` (e.g. "mx/posters/au/moana-2026-f3e28c64.jpg"), not every
 *     movie has one - resolved to an absolute imgix URL by parseMovieMeta().
 *   - GET cinemaapi/sessions/{cinemaId}?partnerId=ALL
 *       -> [ { id, cinemaId, movieId:"HO00008574"(=vistaId), date(local), utcDate, typeId,
 *              originalTags:[...], allocatedSeating, screenName, link } ]
 *     NOTE: per-cinema, ALL movies + ALL dates - no server-side movie/date filter. We filter
 *     client-side by movieId (Hoyts uses the Vista id, e.g. "HO00008574") and date.
 *   - GET ticketing/ticket/seats/{cinemaId}/{sessionId}/
 *       -> { areas:[{id,code,name}], rows:[ { name(rowLabel), seats:[ Slot ] } ] }
 *     Slot is one of: a seat object {areaId,name,number,rowNumber,id,typeId,sold?,unavailable?},
 *     a gap {typeId:"gap"}, or a group {group:[seat,seat], typeId} (paired daybeds/lounges).
 *     `sold`/`unavailable` are present only when true; an absent flag means available.
 *     410 "Session sold out." is returned for fully-sold sessions.
 *
 * GEOMETRY VERDICT: Hoyts exposes NO explicit row/col coordinates. Physical position is implicit
 * in array ORDER - rows top(front)->bottom(back), and seats left->right within each row (gaps
 * included). The SPA itself derives centre from array indices ((cols-1)/2, (rows-1)/2), so we do
 * the same: row = row index (front=0, increasing back), col = running slot index within the row.
 * Geometric centre/depth scoring is therefore APPROXIMATE for Hoyts (index-based, not metric),
 * but matches how Hoyts' own UI lays the auditorium out.
 *
 * The seat-map route is keyed on BOTH cinemaId and sessionId, but ChainAdapter.getSeatMap only
 * receives a sessionId - so Session.id is encoded as "cinemaId:sessionId" and split back here.
 */
export class HoytsAdapter implements ChainAdapter {
  readonly chain = "hoyts" as const;
  private readonly webBase = "https://apim-aea.hoyts.com.au/cinemaapi-au-live/api";
  private readonly ticketingBase = "https://apim-aea.hoyts.com.au/ticketing-au-live/api/v1";
  private readonly siteBase = "https://www.hoyts.com.au";
  private readonly fetchJson: FetchJson;
  // #47 review follow-up: listSessions() used to call listCinemas() unconditionally on every
  // invocation just to resolve cinemaName (#67), doubling outbound requests since the ingester
  // calls listSessions once per (watch, date). Memoize the cinema-list result per adapter instance
  // (mirrors the TtlCache pattern in packages/api/src/index.ts) so repeated calls within one TTL
  // window reuse it. Caches the in-flight promise (not just the resolved value) so concurrent
  // listSessions calls within a tick also collapse to a single upstream fetch.
  private readonly cinemaListTtlMs: number;
  private cinemaListCache?: { expiresAt: number; promise: Promise<Cinema[]> };
  // #72: the per-cinema sessions feed carries no movie title (only the Vista `movieId`) — same gap
  // class as #67's cinemaName. Resolve titles from the chain's own movies list (`GET
  // cinemaapi-au-live/api/movies`, live-verified: entries carry `vistaId` matching Session.movieId
  // and `name`), memoized the same way as cachedCinemas() so repeated/concurrent listSessions calls
  // within the TTL window collapse to one upstream fetch. `vistaId` can itself be a comma-joined
  // list of ids sharing one entry - see parseMovieMeta() for why that must be split.
  private readonly movieListTtlMs: number;
  private movieListCache?: { expiresAt: number; promise: Promise<Map<string, MovieMeta>> };

  constructor(opts?: { fetchJson?: FetchJson; cinemaListTtlMs?: number; movieListTtlMs?: number }) {
    this.fetchJson = opts?.fetchJson ?? defaultFetchJson;
    this.cinemaListTtlMs = opts?.cinemaListTtlMs ?? 60 * 60_000; // 1h default
    this.movieListTtlMs = opts?.movieListTtlMs ?? 60 * 60_000; // 1h default
  }

  async listCinemas(): Promise<Cinema[]> {
    const raw = await this.fetchJson(`${this.webBase}/cinemas`);
    return parseCinemas(raw, this.siteBase);
  }

  /** `vistaId -> name` map from the chain's movies list, for #72 title resolution. */
  async listMovieNames(): Promise<Map<string, string>> {
    const meta = await this.listMovieMeta();
    return new Map([...meta].map(([id, m]) => [id, m.name]));
  }

  /** `vistaId -> {name, posterUrl}` map from the chain's movies list. The sessions feed carries
   *  neither a title (#72) nor artwork; both come from this one movies-list call. Poster paths are
   *  relative (`mx/posters/au/...`) and served via the chain's imgix host. */
  async listMovieMeta(): Promise<Map<string, MovieMeta>> {
    const raw = await this.fetchJson(`${this.webBase}/movies`);
    return parseMovieMeta(raw);
  }

  /** Cached wrapper around listCinemas() for internal cinemaName resolution (see field comment). */
  private cachedCinemas(): Promise<Cinema[]> {
    const now = Date.now();
    if (this.cinemaListCache && now < this.cinemaListCache.expiresAt) {
      return this.cinemaListCache.promise;
    }
    const promise = this.listCinemas();
    this.cinemaListCache = { expiresAt: now + this.cinemaListTtlMs, promise };
    // Don't cache a rejection - clear it so the next call retries against fresh state.
    promise.catch(() => {
      if (this.cinemaListCache?.promise === promise) this.cinemaListCache = undefined;
    });
    return promise;
  }

  /** Cached wrapper around listMovieMeta() for internal movieName/poster resolution (#72, see field comment). */
  private cachedMovieMeta(): Promise<Map<string, MovieMeta>> {
    const now = Date.now();
    if (this.movieListCache && now < this.movieListCache.expiresAt) {
      return this.movieListCache.promise;
    }
    const promise = this.listMovieMeta();
    this.movieListCache = { expiresAt: now + this.movieListTtlMs, promise };
    // Don't cache a rejection - clear it so the next call retries against fresh state.
    promise.catch(() => {
      if (this.movieListCache?.promise === promise) this.movieListCache = undefined;
    });
    return promise;
  }

  async listSessions(query: SessionQuery): Promise<Session[]> {
    // #67: the per-cinema sessions feed carries only `cinemaId`, no name — mirror Event/Village and
    // resolve the real name from the chain's own cinema-list call (the same call listCinemas()
    // makes), reused across calls within the TTL window (see cachedCinemas()).
    // #75 review follow-up: a rejecting cachedMovieNames() (movies endpoint down/429) used to fail
    // the whole Promise.all and abort listSessions entirely, even though title resolution is a
    // best-effort join and session/seat discovery has nothing to do with it. Degrade to an empty Map
    // instead - movieName resolves to "" for this call, sessions/seats still flow.
    const [cinemas, movieMetaById] = await Promise.all([
      this.cachedCinemas(),
      this.cachedMovieMeta().catch(() => new Map<string, MovieMeta>()),
    ]);
    const cinemaNameById = new Map(cinemas.map((c) => [c.id, c.name]));

    const out: Session[] = [];
    for (const cinemaId of query.cinemaIds) {
      const url = `${this.webBase}/sessions/${encodeURIComponent(cinemaId)}?partnerId=ALL`;
      const raw = await this.fetchJson(url);
      out.push(
        ...parseSessions(raw, query, this.siteBase, cinemaNameById.get(cinemaId) ?? "", movieMetaById),
      );
    }
    return out;
  }

  async getSeatMap(sessionId: string, _opts?: { preview?: boolean }): Promise<SeatMap> {
    // Session.id is "cinemaId:sessionId"; the seat route needs both. Tolerate a bare id too.
    const sep = sessionId.indexOf(":");
    const cinemaId = sep >= 0 ? sessionId.slice(0, sep) : "";
    const sid = sep >= 0 ? sessionId.slice(sep + 1) : sessionId;
    const url = `${this.ticketingBase}/ticket/seats/${encodeURIComponent(cinemaId)}/${encodeURIComponent(sid)}/`;
    const raw = await this.fetchJson(url);
    return parseSeatMap(sessionId, raw);
  }
}

// --- HTTP -------------------------------------------------------------------

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
        throw new UpstreamError(`Hoyts request failed: ${res.status} ${res.statusText} (${url})`, {
          kind: "http",
          status: res.status,
        });
      }
      try {
        return await res.json();
      } catch (err) {
        throw new UpstreamError(`Hoyts response was not valid JSON (${url})`, {
          kind: "parse",
          cause: err,
        });
      }
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      if (isAbortError(err)) {
        throw new UpstreamError(`Hoyts request timed out (${url})`, { kind: "timeout", cause: err });
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
      throw new UpstreamError(`Hoyts request failed (${url})`, { kind: "unknown", cause: err });
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
const idStr = (v: unknown): string => String(num(v) ?? str(v) ?? "");

function mapFormat(typeId: unknown): ScreenFormat {
  const raw = str(typeId) ?? "";
  const k = raw.toLowerCase().replace(/[\s-]/g, "");
  let kind: ScreenFormat["kind"];
  if (k.includes("vmax")) kind = "vmax";
  else if (k.includes("imax")) kind = "imax";
  else if (k.includes("lux") || k.includes("platinum")) kind = "premium";
  else if (k.includes("gold")) kind = "goldclass";
  else if (k.includes("standard")) kind = "standard";
  else kind = "other"; // XTREME, DBOX, 3D etc. - Hoyts large/premium formats with no core bucket
  return { kind, raw };
}

function parseSessions(
  raw: unknown,
  query: SessionQuery,
  siteBase: string,
  cinemaName: string,
  movieMetaById: Map<string, MovieMeta>,
): Session[] {
  const out: Session[] = [];
  for (const s of arr(raw)) {
    if (!isObj(s)) continue;
    const movieId = str(s.movieId) ?? idStr(s.movieId);
    // Per-cinema feed carries every movie + every date; filter to the requested ones.
    if (query.movieId && movieId !== query.movieId) continue;
    const date = str(s.date) ?? "";
    if (query.date && !date.startsWith(query.date)) continue;
    const cinemaId = str(s.cinemaId) ?? "";
    const id = idStr(s.id);
    const link = str(s.link) ?? `/orders/tickets?cinemaId=${cinemaId}&sessionId=${id}`;
    const posterUrl = movieMetaById.get(movieId)?.posterUrl;
    out.push({
      chain: "hoyts",
      // Composite so getSeatMap can recover the cinemaId the seat route needs.
      id: cinemaId ? `${cinemaId}:${id}` : id,
      movieId,
      // #72: sessions feed carries no title — resolved from the movies list by `vistaId` (falls
      // back to "" when a movieId isn't in the current movies list, e.g. a stale/delisted title).
      movieName: movieMetaById.get(movieId)?.name ?? "",
      cinemaId,
      // #67: resolved from listCinemas() by the caller (mirrors Event's `cm.Name` / Village's
      // `cinema.name`, which both come embedded in-payload — Hoyts' sessions feed has no name, so we
      // join it in from the cinema-list call instead).
      cinemaName,
      startTime: date, // local, no tz - matches core contract
      format: mapFormat(s.typeId),
      screenName: str(s.screenName),
      seatsAvailable: undefined, // not exposed by the sessions feed
      seatAllocation: s.allocatedSeating === true,
      bookingUrl: link.startsWith("http") ? link : `${siteBase}${link}`,
      attributes: arr(s.originalTags)
        .map((t) => str(t))
        .filter((t): t is string => !!t),
      ...(posterUrl ? { posterUrl } : {}),
    });
  }
  return out;
}

function mapAreaKind(name: unknown): SeatArea["kind"] {
  const n = (str(name) ?? "").toLowerCase();
  if (n.includes("daybed")) return "daybed";
  if (n.includes("recliner")) return "recliner";
  if (n.includes("platinum") || n.includes("lux")) return "premium";
  if (n.includes("gold")) return "goldclass";
  if (n.includes("companion")) return "companion";
  if (n.includes("standard")) return "standard";
  return "other";
}

function mapTypeStatus(typeId: string, seat: Json): SeatStatus {
  if (typeId === "gap") return "spacer";
  if (seat.sold === true) return "sold";
  if (seat.unavailable === true) return "unavailable";
  if (typeId === "companion") return "companion";
  return "available";
}

/** Push one concrete seat (already known not to be a gap) into the accumulator. */
function pushSeat(
  seats: Seat[],
  usedIds: Set<string>,
  seat: Json,
  rowLabel: string,
  rowCoord: number,
  colCoord: number,
  paired: boolean,
): void {
  const typeId = (str(seat.typeId) ?? "").toLowerCase();
  // Bare upstream seat.id repeats across rows (row C "3" and row D "3" both arrive as "3"),
  // which breaks persistence under session_seats (session_id, seat_id). Keep the bare id when
  // it is unique within the map; on collision, qualify it by grid position (row/col coords,
  // which are unique per real seat). Deterministic for the same input ordering. Geometry
  // (rowLabel/row/col) is untouched.
  const base = idStr(seat.id);
  let id = base;
  if (usedIds.has(id)) id = `${base}|${rowCoord}|${colCoord}`;
  usedIds.add(id);
  seats.push({
    id,
    name: str(seat.name),
    rowLabel,
    row: rowCoord,
    col: colCoord,
    status: mapTypeStatus(typeId, seat),
    areaId: idStr(seat.areaId),
    paired,
    premium: typeId.includes("platinum") || typeId.includes("lux"),
    accessible: typeId.includes("wheelchair"),
  });
}

function parseSeatMap(sessionId: string, raw: unknown): SeatMap {
  const root = isObj(raw) ? raw : undefined;
  const areas: SeatArea[] = arr(root?.areas)
    .filter(isObj)
    .map((a) => ({
      id: idStr(a.id),
      name: str(a.name) ?? "",
      code: str(a.code),
      kind: mapAreaKind(a.name),
    }));

  const seats: Seat[] = [];
  // Tracks Seat.id values already emitted in this map so colliding bare ids can be qualified.
  const usedIds = new Set<string>();
  const rows = arr(root?.rows);
  // Row coord: index in the rows array. Hoyts lists front(screen)->back, and core wants
  // HIGHER row = further back - so the index works directly (row 0 = front).
  rows.forEach((row, rowIdx) => {
    if (!isObj(row)) return;
    const rowLabel = str(row.name) ?? "";
    // Col coord: running slot index, left->right as listed (gaps consume a slot, mirroring the
    // SPA's own layout math). Groups (paired daybeds) consume one slot per member.
    let col = 0;
    for (const slot of arr(row.seats)) {
      if (!isObj(slot)) {
        col += 1;
        continue;
      }
      const slotType = (str(slot.typeId) ?? "").toLowerCase();
      if (slotType === "gap") {
        // Preserve structural gaps as spacers so column geometry stays aligned (cf. Event).
        seats.push({
          id: "",
          rowLabel,
          row: rowIdx,
          col,
          status: "spacer",
          areaId: "",
        });
        col += 1;
        continue;
      }
      const group = arr(slot.group).filter(isObj);
      if (group.length > 0) {
        const paired = group.length > 1;
        for (const member of group) {
          pushSeat(seats, usedIds, member, rowLabel, rowIdx, col, paired);
          col += 1;
        }
        continue;
      }
      // Plain single seat (recliner/standard/wheelchair etc.).
      pushSeat(seats, usedIds, slot, rowLabel, rowIdx, col, false);
      col += 1;
    }
  });

  return {
    chain: "hoyts",
    sessionId,
    screenName: str(root?.screenName),
    areas,
    seats,
    // Hoyts publishes no row/col coordinates; positions are inferred from array order (#52).
    geometryConfidence: "approximate",
  };
}

/** Movies-list artwork host: `posterImage` is a relative path, served absolute from here. */
const HOYTS_IMGIX_BASE = "https://imgix.hoyts.com.au/";

/** #72: `vistaId -> {name, posterUrl}` map from the movies list (`GET cinemaapi-au-live/api/movies`). */
function parseMovieMeta(raw: unknown): Map<string, MovieMeta> {
  const out = new Map<string, MovieMeta>();
  for (const node of arr(raw)) {
    if (!isObj(node)) continue;
    const vistaId = str(node.vistaId);
    const name = str(node.name);
    if (!vistaId || !name) continue;
    // Not every movies-list entry carries artwork; treat as optional (see class doc, #72 section).
    const posterImage = str(node.posterImage);
    const posterUrl = posterImage ? `${HOYTS_IMGIX_BASE}${posterImage}` : undefined;
    const meta: MovieMeta = { name, ...(posterUrl ? { posterUrl } : {}) };
    // Live-verified (2026-07-05, cf. Hoyts issue investigation for the 571-session blank-title
    // cluster): `vistaId` is sometimes a COMMA-JOINED list of Vista ids sharing one marketing
    // entry, e.g. `"HO00010000,HO00011219"` for "Spider-Man: Brand New Day" (13 movies observed
    // with this shape at once - all major current/advance-sale titles, always exactly 2 ids,
    // second id block sequential ~HO000112xx - looks like a paired technical/release-window
    // variant sharing one listing). A session's `movieId` is always a single bare id, so indexing
    // the raw joined string as one map key meant NEITHER id ever matched - the join silently
    // produced "" for every session of these movies, and #75's cache-heal had nothing to heal
    // from since fresh discovery data was blank too. Split on comma and index each id to the same
    // meta; harmless no-op for the common single-id case.
    for (const id of vistaId.split(",")) {
      const trimmed = id.trim();
      if (trimmed) out.set(trimmed, meta);
    }
  }
  return out;
}

function parseCinemas(raw: unknown, siteBase: string): Cinema[] {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.Data) ? raw.Data : [];
  const out: Cinema[] = [];
  for (const node of list) {
    if (!isObj(node)) continue;
    const id = idStr(node.id);
    const name = str(node.name) ?? "";
    if (!id && !name) continue;
    const region = str(node.state);
    const link = str(node.link);
    const url = link ? (link.startsWith("http") ? link : `${siteBase}${link}`) : undefined;
    out.push({
      chain: "hoyts",
      id,
      name,
      ...(region ? { region } : {}),
      ...(url ? { url } : {}),
    });
  }
  return out;
}
