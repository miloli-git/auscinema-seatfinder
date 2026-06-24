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

/**
 * Hoyts Cinemas adapter — reverse-engineered, open JSON API (no auth/subscription key).
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
 *   - GET cinemaapi/sessions/{cinemaId}?partnerId=ALL
 *       -> [ { id, cinemaId, movieId:"HO00008574"(=vistaId), date(local), utcDate, typeId,
 *              originalTags:[...], allocatedSeating, screenName, link } ]
 *     NOTE: per-cinema, ALL movies + ALL dates — no server-side movie/date filter. We filter
 *     client-side by movieId (Hoyts uses the Vista id, e.g. "HO00008574") and date.
 *   - GET ticketing/ticket/seats/{cinemaId}/{sessionId}/
 *       -> { areas:[{id,code,name}], rows:[ { name(rowLabel), seats:[ Slot ] } ] }
 *     Slot is one of: a seat object {areaId,name,number,rowNumber,id,typeId,sold?,unavailable?},
 *     a gap {typeId:"gap"}, or a group {group:[seat,seat], typeId} (paired daybeds/lounges).
 *     `sold`/`unavailable` are present only when true; an absent flag means available.
 *     410 "Session sold out." is returned for fully-sold sessions.
 *
 * GEOMETRY VERDICT: Hoyts exposes NO explicit row/col coordinates. Physical position is implicit
 * in array ORDER — rows top(front)->bottom(back), and seats left->right within each row (gaps
 * included). The SPA itself derives centre from array indices ((cols-1)/2, (rows-1)/2), so we do
 * the same: row = row index (front=0, increasing back), col = running slot index within the row.
 * Geometric centre/depth scoring is therefore APPROXIMATE for Hoyts (index-based, not metric),
 * but matches how Hoyts' own UI lays the auditorium out.
 *
 * The seat-map route is keyed on BOTH cinemaId and sessionId, but ChainAdapter.getSeatMap only
 * receives a sessionId — so Session.id is encoded as "cinemaId:sessionId" and split back here.
 */
export class HoytsAdapter implements ChainAdapter {
  readonly chain = "hoyts" as const;
  private readonly webBase = "https://apim-aea.hoyts.com.au/cinemaapi-au-live/api";
  private readonly ticketingBase = "https://apim-aea.hoyts.com.au/ticketing-au-live/api/v1";
  private readonly siteBase = "https://www.hoyts.com.au";
  private readonly fetchJson: FetchJson;

  constructor(opts?: { fetchJson?: FetchJson }) {
    this.fetchJson = opts?.fetchJson ?? defaultFetchJson;
  }

  async listCinemas(): Promise<Cinema[]> {
    const raw = await this.fetchJson(`${this.webBase}/cinemas`);
    return parseCinemas(raw, this.siteBase);
  }

  async listSessions(query: SessionQuery): Promise<Session[]> {
    const out: Session[] = [];
    for (const cinemaId of query.cinemaIds) {
      const url = `${this.webBase}/sessions/${encodeURIComponent(cinemaId)}?partnerId=ALL`;
      const raw = await this.fetchJson(url);
      out.push(...parseSessions(raw, query, this.siteBase));
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

/** Real network call: 15s timeout, one retry on network error. Failures throw a typed UpstreamError. */
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
      throw err; // network error — retried below, then normalised
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await attempt();
  } catch {
    // One retry on network/abort error (cheap, idempotent GET).
    try {
      return await attempt();
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      throw new UpstreamError(`Hoyts request failed (${url})`, { kind: "unknown", cause: err });
    }
  }
};

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
  else kind = "other"; // XTREME, DBOX, 3D etc. — Hoyts large/premium formats with no core bucket
  return { kind, raw };
}

function parseSessions(raw: unknown, query: SessionQuery, siteBase: string): Session[] {
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
    out.push({
      chain: "hoyts",
      // Composite so getSeatMap can recover the cinemaId the seat route needs.
      id: cinemaId ? `${cinemaId}:${id}` : id,
      movieId,
      movieName: "", // sessions feed carries no title; resolve via /movies/* if needed
      cinemaId,
      cinemaName: "",
      startTime: date, // local, no tz — matches core contract
      format: mapFormat(s.typeId),
      screenName: str(s.screenName),
      seatsAvailable: undefined, // not exposed by the sessions feed
      seatAllocation: s.allocatedSeating === true,
      bookingUrl: link.startsWith("http") ? link : `${siteBase}${link}`,
      attributes: arr(s.originalTags)
        .map((t) => str(t))
        .filter((t): t is string => !!t),
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
  seat: Json,
  rowLabel: string,
  rowCoord: number,
  colCoord: number,
  paired: boolean,
): void {
  const typeId = (str(seat.typeId) ?? "").toLowerCase();
  seats.push({
    id: idStr(seat.id),
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
  const rows = arr(root?.rows);
  // Row coord: index in the rows array. Hoyts lists front(screen)->back, and core wants
  // HIGHER row = further back — so the index works directly (row 0 = front).
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
          pushSeat(seats, member, rowLabel, rowIdx, col, paired);
          col += 1;
        }
        continue;
      }
      // Plain single seat (recliner/standard/wheelchair etc.).
      pushSeat(seats, slot, rowLabel, rowIdx, col, false);
      col += 1;
    }
  });

  return {
    chain: "hoyts",
    sessionId,
    screenName: str(root?.screenName),
    areas,
    seats,
  };
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
