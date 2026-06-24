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

/**
 * Injectable HTTP-JSON fetcher so parsing can run against fixtures without network.
 * Unlike Event/Hoyts (GET-only), Reading needs POST bodies (seat map) and a bearer token,
 * so the fetcher takes an optional `init`.
 */
export type FetchInit = { method?: "GET" | "POST"; body?: unknown; token?: string };
export type FetchJson = (url: string, init?: FetchInit) => Promise<unknown>;

/**
 * Reading Cinemas (AU) adapter — reverse-engineered. The readingcinemas.com.au React SPA is a
 * thin shell; the real backend is an AWS API-Gateway facade over Vista
 * (`VistaUrl: prod-au-vista.readingcinemas.com.au`) at `https://prod-api.readingcinemas.com.au`.
 *
 * AUTH: every data route sits behind a Lambda authorizer requiring `Authorization: Bearer <token>`.
 * The token is a *public bootstrap* Cognito access token handed out by `GET /settings/{countryId}`
 * (`data.settings.token`). No login/subscription key is needed — the SPA fetches it on boot and
 * reuses it for all reads. We do the same and cache it for the adapter's lifetime.
 *
 * countryId is fixed to "1" (Australia; NZ=2, Angelika=3, State=4, US=5 share the same API).
 *
 * Routes (all need the bearer token):
 *   - GET  /settings/{countryId}                         -> { data:{ settings:{ token, ... } } }
 *   - GET  /getcinemas?countryId=1                       -> [ { slug, name, state, stateCode, ... } ]
 *       Cinema id is the `slug` (e.g. "auburn"); it keys the session + seat routes.
 *   - GET  /films?countryId=1&cinemaId={slug}&status=nowShowing
 *       -> { data:[ { name, slug(=SPA film id), showdates:[ { date, showtypes:[ { type,
 *              showtimes:[ { id, ScheduledFilmId(=Vista film id), date_time, reservedSeating,
 *              availableSeats, totalNumberOfSeats, type, soldout } ] } ] } ] } ] }
 *       Per-cinema, ALL movies + ALL dates — we filter client-side by movieId + date (cf. Hoyts).
 *   - POST /ticketing/tickettypes  { cinemaId, sessionId, reservedSeating, requestType:"seatPlan",
 *              covidFlag:0, countryId:"1", screenType, showLoyaltyTicket:true }
 *       -> { data:{ ticketType:[...], seatLayout:[ row -> { colKey: SeatCell } ],
 *              seatLayoutCategory:{ category:[rowIdx...] } } }
 *     SeatCell: { seatType:"Empty"|"Aisle"|"Sold"|"Companion"|"Special"|"Broken"|..., seatId,
 *                 isAvailable, isBooked, row, column, areaNumber, category, areaCategoryCode }.
 *
 * GEOMETRY VERDICT: Reading EXPOSES explicit grid coordinates per seat (`row`, `column`) — true
 * geometry, not just array order. Vista numbers `row` front->back DESCENDING (front row = highest)
 * and `column` left->right DESCENDING, so we negate both to honour the core contract (higher row =
 * further back, col increases left->right). Scoring is geometry-correct, not approximate.
 *
 * The seat route needs cinemaId + screenType + reservedSeating in addition to the session id, but
 * ChainAdapter.getSeatMap only receives a sessionId — so Session.id is encoded as
 * "{cinemaId}|{sessionId}|{screenType}|{reservedSeating}" and split back here (cf. Hoyts' trick).
 */
export class ReadingAdapter implements ChainAdapter {
  readonly chain = "reading" as const;
  private readonly base = "https://prod-api.readingcinemas.com.au";
  private readonly siteBase = "https://readingcinemas.com.au";
  private readonly countryId = "1";
  private readonly fetchJson: FetchJson;
  private tokenCache?: string;

  constructor(opts?: { fetchJson?: FetchJson }) {
    this.fetchJson = opts?.fetchJson ?? defaultFetchJson;
  }

  /** Fetch + cache the public bootstrap bearer token from /settings/{countryId}. */
  private async token(): Promise<string> {
    if (this.tokenCache) return this.tokenCache;
    const raw = await this.fetchJson(`${this.base}/settings/${this.countryId}`);
    const data = isObj(raw) && isObj(raw.data) ? raw.data : undefined;
    const settings = isObj(data?.settings) ? data.settings : undefined;
    const tok = str(settings?.token);
    if (!tok) {
      throw new UpstreamError("Reading: no bootstrap token in /settings response", { kind: "auth" });
    }
    this.tokenCache = tok;
    return tok;
  }

  async listCinemas(): Promise<Cinema[]> {
    const token = await this.token();
    const raw = await this.fetchJson(`${this.base}/getcinemas?countryId=${this.countryId}`, { token });
    return parseCinemas(raw, this.siteBase);
  }

  async listSessions(query: SessionQuery): Promise<Session[]> {
    const token = await this.token();
    const out: Session[] = [];
    for (const cinemaId of query.cinemaIds) {
      const url =
        `${this.base}/films?countryId=${this.countryId}` +
        `&cinemaId=${encodeURIComponent(cinemaId)}&status=nowShowing`;
      const raw = await this.fetchJson(url, { token });
      out.push(...parseSessions(raw, cinemaId, query, this.siteBase));
    }
    return out;
  }

  async getSeatMap(sessionId: string, _opts?: { preview?: boolean }): Promise<SeatMap> {
    const { cinemaId, sid, screenType, reservedSeating } = decodeSessionId(sessionId);
    const token = await this.token();
    const body = {
      cinemaId,
      sessionId: sid,
      reservedSeating,
      requestType: "seatPlan",
      covidFlag: 0,
      countryId: this.countryId,
      screenType,
      showLoyaltyTicket: true,
    };
    const raw = await this.fetchJson(`${this.base}/ticketing/tickettypes`, {
      method: "POST",
      body,
      token,
    });
    return parseSeatMap(sessionId, raw);
  }
}

// --- session id codec -------------------------------------------------------

/** "{cinemaId}|{sessionId}|{screenType}|{reservedSeating}". Tolerates a bare session id. */
function decodeSessionId(id: string): {
  cinemaId: string;
  sid: string;
  screenType: string;
  reservedSeating: number;
} {
  const parts = id.split("|");
  if (parts.length >= 2) {
    return {
      cinemaId: parts[0] ?? "",
      sid: parts[1] ?? "",
      screenType: parts[2] ?? "",
      reservedSeating: Number.parseInt(parts[3] ?? "1", 10) || 1,
    };
  }
  return { cinemaId: "", sid: id, screenType: "", reservedSeating: 1 };
}

// --- HTTP -------------------------------------------------------------------

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
};

/** Real network call: 15s timeout, one retry on network error. Failures throw a typed UpstreamError. */
const defaultFetchJson: FetchJson = async (url, init) => {
  const attempt = async (): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const headers: Record<string, string> = { ...BROWSER_HEADERS };
      if (init?.token) headers.Authorization = `Bearer ${init.token}`;
      const opts: RequestInit = { method: init?.method ?? "GET", headers, signal: controller.signal };
      if (init?.body !== undefined) {
        headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(init.body);
      }
      const res = await fetch(url, opts);
      if (!res.ok) {
        // 401/403 on a data route = the bootstrap token was rejected/expired -> auth.
        const kind = res.status === 401 || res.status === 403 ? "auth" : "http";
        throw new UpstreamError(`Reading request failed: ${res.status} ${res.statusText} (${url})`, {
          kind,
          status: res.status,
        });
      }
      try {
        return await res.json();
      } catch (err) {
        throw new UpstreamError(`Reading response was not valid JSON (${url})`, {
          kind: "parse",
          cause: err,
        });
      }
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      if (isAbortError(err)) {
        throw new UpstreamError(`Reading request timed out (${url})`, { kind: "timeout", cause: err });
      }
      throw err; // network error — retried below, then normalised
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await attempt();
  } catch {
    // One retry on network/abort error (cheap, idempotent GET/POST of a read query).
    try {
      return await attempt();
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      throw new UpstreamError(`Reading request failed (${url})`, { kind: "unknown", cause: err });
    }
  }
};

// --- Parsing ----------------------------------------------------------------

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

function mapFormat(type: unknown): ScreenFormat {
  const raw = str(type) ?? "";
  const k = raw.toLowerCase().replace(/[\s-]/g, "");
  let kind: ScreenFormat["kind"];
  if (k.includes("vmax")) kind = "vmax";
  else if (k.includes("imax")) kind = "imax";
  else if (k.includes("gold")) kind = "goldclass";
  else if (k.includes("premium") || k.includes("titanluxe")) kind = "premium";
  else if (k.includes("standard")) kind = "standard";
  else kind = "other"; // TitanXC and other large formats — no core bucket
  return { kind, raw };
}

/** Pull the `data` payload, tolerating either a bare value or a { statusCode, data } envelope. */
function unwrap(raw: unknown): unknown {
  if (isObj(raw) && "data" in raw) return raw.data;
  return raw;
}

function parseSessions(
  raw: unknown,
  cinemaId: string,
  query: SessionQuery,
  siteBase: string,
): Session[] {
  const movies = arr(unwrap(raw));
  const out: Session[] = [];
  for (const movie of movies) {
    if (!isObj(movie)) continue;
    const movieName = str(movie.name) ?? "";
    const movieSlug = str(movie.slug) ?? ""; // SPA film id used in the booking deep-link
    for (const sd of arr(movie.showdates)) {
      if (!isObj(sd)) continue;
      const date = str(sd.date) ?? "";
      for (const stype of arr(sd.showtypes)) {
        if (!isObj(stype)) continue;
        for (const sh of arr(stype.showtimes)) {
          if (!isObj(sh)) continue;
          // Vista global film id (e.g. "HO00004264") is the portable movie id, mirroring Hoyts.
          const movieId = str(sh.ScheduledFilmId) ?? "";
          if (query.movieId && movieId !== query.movieId) continue;
          if (query.date && date && !date.startsWith(query.date)) continue;
          const sid = String(num(sh.id) ?? str(sh.id) ?? "");
          const screenType = str(sh.type) ?? str(stype.type) ?? "";
          const reservedSeating = num(sh.reservedSeating) ?? (sh.reservedSeating === "1" ? 1 : 0);
          out.push({
            chain: "reading",
            // Composite so getSeatMap can rebuild the seat-route request.
            id: `${cinemaId}|${sid}|${screenType}|${reservedSeating}`,
            movieId,
            movieName,
            cinemaId,
            cinemaName: "",
            startTime: str(sh.date_time) ?? "",
            format: mapFormat(screenType),
            screenName: str(sh.auditorium) || undefined,
            seatsAvailable:
              num(sh.availableSeats) ??
              (typeof sh.availableSeats === "string"
                ? Number.parseInt(sh.availableSeats, 10) || undefined
                : undefined),
            seatAllocation: reservedSeating === 1,
            bookingUrl: `${siteBase}/sessions/${sid}/${movieSlug}`,
            attributes: arr(stype.amenities)
              .map((a) => str(a))
              .filter((a): a is string => !!a),
          });
        }
      }
    }
  }
  return out;
}

function mapAreaKind(category: unknown): SeatArea["kind"] {
  const c = (str(category) ?? "").toLowerCase();
  if (c.includes("gold")) return "goldclass";
  if (c.includes("premium") || c.includes("platinum")) return "premium";
  if (c.includes("daybed")) return "daybed";
  if (c.includes("recliner") || c.includes("lounge")) return "recliner";
  if (c.includes("companion")) return "companion";
  if (c.includes("standard")) return "standard";
  return "other";
}

function mapSeatStatus(seatType: string, cell: Json): SeatStatus {
  const t = seatType.toLowerCase();
  if (t === "aisle" || t === "space" || t === "spacer") return "spacer";
  if (cell.isBooked === true || t === "sold") return "sold";
  if (t === "companion") return "companion";
  if (t === "special") return "special";
  if (t === "broken" || t === "house" || t === "unavailable") return "unavailable";
  if (cell.isAvailable === false) return "unavailable";
  return "available"; // "Empty" = an empty (i.e. selectable) seat in Vista's vocabulary
}

function parseSeatMap(sessionId: string, raw: unknown): SeatMap {
  const data = unwrap(raw);
  const rows = arr(isObj(data) ? data.seatLayout : undefined);

  const seats: Seat[] = [];
  const areaSeen = new Map<string, SeatArea>();

  // Each row is an object keyed by visual column index ("0".."N"); iterate keys in numeric order.
  rows.forEach((rowObj) => {
    if (!isObj(rowObj)) return;
    const keys = Object.keys(rowObj).sort((a, b) => Number(a) - Number(b));
    for (const key of keys) {
      const cell = rowObj[key];
      if (!isObj(cell)) continue;
      const seatType = str(cell.seatType) ?? "";
      const status = mapSeatStatus(seatType, cell);
      const seatId = str(cell.seatId) ?? "";
      const rowLabel = seatId.replace(/[0-9].*$/, ""); // "F5" -> "F"; aisles carry just the letter
      // Vista grid coords: row front->back DESCENDING, column left->right DESCENDING. Negate both
      // so core gets higher=back, col increasing left->right (cf. Event's encoding).
      const physRow = num(cell.row);
      const physCol = num(cell.column);
      const areaCode = str(cell.areaCategoryCode) ?? "";
      const category = str(cell.category) ?? "";
      if (areaCode && !areaSeen.has(areaCode)) {
        areaSeen.set(areaCode, {
          id: areaCode,
          name: category || areaCode,
          code: category || undefined,
          kind: mapAreaKind(category),
        });
      }
      if (status === "spacer") {
        // Preserve aisles as spacers so column geometry stays aligned (cf. Event/Hoyts).
        seats.push({
          id: "",
          rowLabel,
          row: physRow !== undefined ? -physRow : 0,
          col: physCol !== undefined ? -physCol : 0,
          status: "spacer",
          areaId: areaCode,
        });
        continue;
      }
      seats.push({
        id: seatId,
        name: seatId,
        rowLabel,
        row: physRow !== undefined ? -physRow : 0,
        col: physCol !== undefined ? -physCol : 0,
        status,
        areaId: areaCode,
        accessible: seatType.toLowerCase() === "wheelchair" || undefined,
      });
    }
  });

  return {
    chain: "reading",
    sessionId,
    areas: [...areaSeen.values()],
    seats,
  };
}

function parseCinemas(raw: unknown, siteBase: string): Cinema[] {
  const list = arr(unwrap(raw));
  const out: Cinema[] = [];
  for (const node of list) {
    if (!isObj(node)) continue;
    const id = str(node.slug) ?? "";
    const name = str(node.name) ?? str(node.long_name) ?? "";
    if (!id && !name) continue;
    const region = str(node.stateCode) ?? str(node.state);
    out.push({
      chain: "reading",
      id,
      name,
      ...(region ? { region } : {}),
      ...(id ? { url: `${siteBase}/cinemas/${id}` } : {}),
    });
  }
  return out;
}
