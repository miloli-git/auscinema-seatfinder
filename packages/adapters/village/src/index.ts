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
 * Village's read endpoints are all GET (no body, no auth) so the signature stays minimal,
 * mirroring Event/Hoyts.
 */
export type FetchJson = (url: string) => Promise<unknown>;

/**
 * Village Cinemas (AU) adapter — reverse-engineered.
 *
 * villagecinemas.com.au is a Next.js (App Router) site that *is* fronted by Cloudflare, but the
 * interstitial only guards the document routes — the JSON route handlers under `/api/...` answer a
 * plain browser `User-Agent` with no challenge, no auth, no subscription key. Three open feeds give
 * the whole chain:
 *
 *   - Sessions (the showtimes index): `GET /api/algolia/sessions/hits` — a server-side proxy over
 *     the site's Algolia "sessions" index. Unfiltered it returns ALL sessions (~11k, capped at 1000
 *     per call); facet filters narrow it server-side. Facet param = `f.<code>` where the codes are
 *     `c`=cinema.cinemaId, `m`=movie.movieHoCode, `d`=date, `x`=experience.vistaAttributeCode
 *     (mined from the bundle's `{accessibility:"a",cinemaIds:"c",dates:"d",...,movieHoCodes:"m"}`
 *     map and the `f.` prefix). Repeating a param ORs values within a facet; different facets AND.
 *     So one call with every `f.c`, plus `f.m` + `f.d`, returns exactly the wanted sessions. Each
 *     hit carries the full `cinema` object (id/name/state/suburb/coords) and `movie.movieHoCode` —
 *     so listCinemas just dedupes the cinema objects out of one unfiltered hits call (all 23 AU
 *     cinemas appear in the first 1000 hits).
 *
 *   - Seat map: `GET /api/session/seat-map?cinemaId={id}&sessionId={id}` — returns a bare array of
 *     area objects, each `{ areaCategoryCode, areaNumber, description, rows:[ { physicalName, name,
 *     seats:[ Cell ] } ] }`. The seat route needs BOTH cinemaId and sessionId, but
 *     ChainAdapter.getSeatMap only receives a session id — so Session.id is encoded as
 *     "{cinemaId}|{sessionId}" and split back here (cf. Hoyts/Reading).
 *
 * Cinema id is the Vista 3-digit site code (e.g. "027" = Albury, "272" = Airport West).
 * movieId is the Vista HO code (`movie.movieHoCode`, e.g. "HO00016727") — the portable movie id.
 *
 * GEOMETRY VERDICT: Village (Vista) EXPOSES explicit grid coordinates per seat — `position.row` and
 * `position.column` ints — true geometry, not array order. Vista numbers `position.row` front->back
 * DESCENDING (front row = highest) and `position.column` left->right DESCENDING, so we negate both
 * to honour the core contract (higher row = further back, col increases left->right; same encoding
 * as Event/Reading). Structural gaps are emitted as cells with `status:-1` and an empty `seatId`
 * (e.g. id "A-empty-1") — we map those to `spacer` so column geometry stays aligned.
 */
export class VillageAdapter implements ChainAdapter {
  readonly chain = "village" as const;
  private readonly base = "https://villagecinemas.com.au";
  private readonly fetchJson: FetchJson;

  constructor(opts?: { fetchJson?: FetchJson }) {
    this.fetchJson = opts?.fetchJson ?? defaultFetchJson;
  }

  async listCinemas(): Promise<Cinema[]> {
    const raw = await this.fetchJson(`${this.base}/api/algolia/sessions/hits`);
    return parseCinemas(raw, this.base);
  }

  async listSessions(query: SessionQuery): Promise<Session[]> {
    const params = new URLSearchParams();
    for (const cinemaId of query.cinemaIds) params.append("f.c", cinemaId);
    if (query.movieId) params.append("f.m", query.movieId);
    if (query.date) params.append("f.d", query.date);
    const qs = params.toString();
    const raw = await this.fetchJson(`${this.base}/api/algolia/sessions/hits${qs ? `?${qs}` : ""}`);
    return parseSessions(raw, query, this.base);
  }

  async getSeatMap(sessionId: string, _opts?: { preview?: boolean }): Promise<SeatMap> {
    const { cinemaId, sid } = decodeSessionId(sessionId);
    const url =
      `${this.base}/api/session/seat-map` +
      `?cinemaId=${encodeURIComponent(cinemaId)}&sessionId=${encodeURIComponent(sid)}`;
    const raw = await this.fetchJson(url);
    return parseSeatMap(sessionId, raw);
  }
}

// --- session id codec -------------------------------------------------------

/** "{cinemaId}|{sessionId}". Tolerates a bare session id (no cinema). */
function decodeSessionId(id: string): { cinemaId: string; sid: string } {
  const parts = id.split("|");
  if (parts.length >= 2) return { cinemaId: parts[0] ?? "", sid: parts[1] ?? "" };
  return { cinemaId: "", sid: id };
}

// --- HTTP -------------------------------------------------------------------

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};

/** Real network call: 15s timeout, one retry on network error. Failures throw a typed UpstreamError. */
const defaultFetchJson: FetchJson = async (url) => {
  const attempt = async (): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal });
      if (!res.ok) {
        throw new UpstreamError(`Village request failed: ${res.status} ${res.statusText} (${url})`, {
          kind: "http",
          status: res.status,
        });
      }
      try {
        return await res.json();
      } catch (err) {
        throw new UpstreamError(`Village response was not valid JSON (${url})`, {
          kind: "parse",
          cause: err,
        });
      }
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      if (isAbortError(err)) {
        throw new UpstreamError(`Village request timed out (${url})`, { kind: "timeout", cause: err });
      }
      throw err; // network error — retried below, then normalised
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await attempt();
  } catch {
    // One retry on network/abort error (cheap, idempotent GET of a read query).
    try {
      return await attempt();
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      throw new UpstreamError(`Village request failed (${url})`, { kind: "unknown", cause: err });
    }
  }
};

// --- Parsing ----------------------------------------------------------------

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** Algolia hits envelope: `{ hits:[...] }`. Tolerates a bare array too. */
function hits(raw: unknown): Json[] {
  const list = isObj(raw) ? arr(raw.hits) : arr(raw);
  return list.filter(isObj);
}

function mapFormat(attr: string, label: string): ScreenFormat {
  const raw = label || attr;
  const k = (attr || label).toLowerCase().replace(/[\s-]/g, "");
  let kind: ScreenFormat["kind"];
  if (k.includes("gold")) kind = "goldclass";
  else if (k.includes("imax")) kind = "imax";
  else if (k.includes("vmax")) kind = "vmax";
  else if (k.includes("vpremium") || k.includes("premium") || k.includes("suite")) kind = "premium";
  else if (k.includes("standard")) kind = "standard";
  else kind = "other"; // 4DX / Europa / Vjunior / Drive-In / VR Cinema — no core bucket
  return { kind, raw };
}

/** "2026-06-24T15:30:00.000000+10:00" -> "2026-06-24T15:30:00+10:00" (drop microseconds). */
function cleanTime(s: string | undefined): string {
  return (s ?? "").replace(/\.\d+(?=[+\-Z]|$)/, "");
}

function parseSessions(raw: unknown, query: SessionQuery, base: string): Session[] {
  const out: Session[] = [];
  const wantCinemas = new Set(query.cinemaIds);
  for (const hit of hits(raw)) {
    const cinema = isObj(hit.cinema) ? hit.cinema : {};
    const movie = isObj(hit.movie) ? hit.movie : {};
    const experience = isObj(hit.experience) ? hit.experience : {};
    const cinemaId = str(cinema.cinemaId) ?? "";
    const movieId = str(movie.movieHoCode) ?? "";
    const date = str(hit.date) ?? "";
    // Defensive client-side filter — the feed is authoritative, but never trust a proxy blindly.
    if (wantCinemas.size && cinemaId && !wantCinemas.has(cinemaId)) continue;
    if (query.movieId && movieId && movieId !== query.movieId) continue;
    if (query.date && date && !date.startsWith(query.date)) continue;

    const sessionId = String(str(hit.sessionId) ?? num(hit.sessionId) ?? "");
    const attr = str(experience.vistaAttributeCode) ?? "";
    const label = str(experience.label) ?? "";
    const attributes = [...arr(hit.seatingAttributes), ...arr(hit.secondaryAttributes)]
      .map((a) => (isObj(a) ? str(a.code) ?? str(a.label) : str(a)))
      .filter((a): a is string => !!a);

    out.push({
      chain: "village",
      // Composite so getSeatMap can rebuild the seat-route request (needs cinemaId + sessionId).
      id: `${cinemaId}|${sessionId}`,
      movieId,
      movieName: str(movie.title) ?? "",
      cinemaId,
      cinemaName: str(cinema.name) ?? "",
      startTime: cleanTime(str(hit.showtime)) || date,
      format: mapFormat(attr, label),
      seatsAvailable: num(hit.seatsAvailable),
      seatAllocation: hit.isAllocatedSeating === true,
      bookingUrl: `${base}/order/tickets?cinemaId=${encodeURIComponent(
        cinemaId,
      )}&sessionId=${encodeURIComponent(sessionId)}`,
      ...(attributes.length ? { attributes } : {}),
    });
  }
  return out;
}

function parseCinemas(raw: unknown, base: string): Cinema[] {
  const seen = new Map<string, Cinema>();
  for (const hit of hits(raw)) {
    const cinema = isObj(hit.cinema) ? hit.cinema : undefined;
    if (!cinema) continue;
    const id = str(cinema.cinemaId) ?? "";
    if (!id || seen.has(id)) continue;
    const name = str(cinema.name) ?? str(cinema.suburb) ?? "";
    const region = str(cinema.state);
    seen.set(id, {
      chain: "village",
      id,
      name,
      ...(region ? { region } : {}),
      url: `${base}/order/tickets?cinemaId=${encodeURIComponent(id)}`,
    });
  }
  return [...seen.values()];
}

function mapAreaKind(description: unknown): SeatArea["kind"] {
  const c = (str(description) ?? "").toLowerCase();
  if (c.includes("gold")) return "goldclass";
  if (c.includes("premium") || c.includes("platinum") || c.includes("suite")) return "premium";
  if (c.includes("daybed") || c.includes("bean")) return "daybed";
  if (c.includes("recliner") || c.includes("lounge") || c.includes("sofa")) return "recliner";
  if (c.includes("companion") || c.includes("carer")) return "companion";
  if (c.includes("standard")) return "standard";
  return "other";
}

/** A cell with no real `seatId` (or Vista status -1) is a structural gap/aisle, not a seat. */
function isSpacerCell(cell: Json): boolean {
  return num(cell.status) === -1 || !str(cell.seatId);
}

function mapSeatStatus(cell: Json): SeatStatus {
  if (isSpacerCell(cell)) return "spacer";
  if (str(cell.seatStatus)?.toLowerCase() === "unavailable") return "sold"; // booked real seat
  if (cell.isCarerSeat === true) return "companion";
  return "available";
}

function parseSeatMap(sessionId: string, raw: unknown): SeatMap {
  const areasRaw = arr(raw).filter(isObj);
  const seats: Seat[] = [];
  const areaSeen = new Map<string, SeatArea>();

  for (const area of areasRaw) {
    const areaCode = str(area.areaCategoryCode) ?? "";
    const description = str(area.description) ?? "";
    if (areaCode && !areaSeen.has(areaCode)) {
      areaSeen.set(areaCode, {
        id: areaCode,
        name: description || areaCode,
        ...(description ? { code: description } : {}),
        kind: mapAreaKind(description),
      });
    }
    for (const row of arr(area.rows)) {
      if (!isObj(row)) continue;
      for (const cellRaw of arr(row.seats)) {
        if (!isObj(cellRaw)) continue;
        const cell = cellRaw;
        const status = mapSeatStatus(cell);
        const pos = isObj(cell.position) ? cell.position : {};
        const physRow = num(pos.row);
        const physCol = num(pos.column);
        // Vista grid: row front->back DESCENDING, column left->right DESCENDING — negate both so
        // core gets higher=further-back, col increasing left->right (cf. Event/Reading).
        const coreRow = physRow !== undefined ? -physRow : 0;
        const coreCol = physCol !== undefined ? -physCol : 0;

        if (status === "spacer") {
          seats.push({
            id: "",
            rowLabel: str(cell.row) ?? "",
            row: coreRow,
            col: coreCol,
            status: "spacer",
            areaId: areaCode,
          });
          continue;
        }

        const seatId = str(cell.seatId) ?? "";
        seats.push({
          id: seatId,
          name: seatId || undefined,
          rowLabel: str(cell.row) ?? "",
          row: coreRow,
          col: coreCol,
          status,
          areaId: str(cell.areaCategoryCode) ?? areaCode,
          ...(cell.isRecliner === true || cell.isLounge === true || cell.isSofa === true
            ? { premium: true }
            : {}),
          ...(cell.isWheelChair === true ? { accessible: true } : {}),
          ...(cell.isDayBed === true || cell.isSofa === true ? { paired: true } : {}),
        });
      }
    }
  }

  return {
    chain: "village",
    sessionId,
    areas: [...areaSeen.values()],
    seats,
  };
}
