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

/** Injectable HTTP-JSON fetcher so parsing can run against fixtures without network. */
export type FetchJson = (url: string) => Promise<unknown>;

/**
 * Event Cinemas adapter — the reference implementation.
 *
 * Backend (reverse-engineered, no auth, send a browser UA + `X-Requested-With: XMLHttpRequest`):
 *   - GET /Cinemas/GetSessions?cinemaIds=58&movieId=19797&date=2026-07-21
 *       -> { Success, Data: { Movies:[ { Id, Name, CinemaModels:[ { Id, Name, Sessions:[ {Id,StartTime,...} ] } ] } ] } }
 *   - GET /Ticketing/Order/GetSeating?sessionId=15433720
 *       -> { Success, Data: { Seats:{ Rows:[ {RowName, Seats:[ {SeatId,SeatName,Status,AreaId,...} ]} ] }, Areas:[...] } }
 *   - GET /api/cinemas/JsonLd -> schema.org-ish list of cinemas
 *
 * SeatId encodes physical geometry as "area|type|ROW|COLUMN" — the last two ints are the grid
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
    const raw = await this.fetchJson(`${this.base}/api/cinemas/JsonLd`);
    return parseCinemas(raw);
  }

  async listSessions(query: SessionQuery): Promise<Session[]> {
    const ids = query.cinemaIds.join(",");
    const url =
      `${this.base}/Cinemas/GetSessions?cinemaIds=${encodeURIComponent(ids)}` +
      `&movieId=${encodeURIComponent(query.movieId)}&date=${encodeURIComponent(query.date)}`;
    const raw = await this.fetchJson(url);
    return parseSessions(raw);
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

/** Real network call: 15s timeout, one retry on network error. */
const defaultFetchJson: FetchJson = async (url) => {
  const attempt = async (): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal });
      if (!res.ok) throw new Error(`Event request failed: ${res.status} ${res.statusText} (${url})`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await attempt();
  } catch {
    // One retry on network/abort error (cheap, idempotent GET).
    return await attempt();
  }
};

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

function parseCinemas(raw: unknown): Cinema[] {
  // /api/cinemas/JsonLd shape is schema.org-ish; parse defensively. Accept either a bare
  // array, an { itemListElement: [...] } list, or a { Data: [...] } envelope.
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (isObj(raw)) {
    if (Array.isArray(raw.itemListElement)) list = raw.itemListElement;
    else if (Array.isArray(raw.Data)) list = raw.Data;
    else if (isObj(raw.Data) && Array.isArray((raw.Data as Json).itemListElement))
      list = (raw.Data as Json).itemListElement as unknown[];
  }
  const out: Cinema[] = [];
  for (const entry of list) {
    if (!isObj(entry)) continue;
    // schema.org ItemList wraps each cinema under `item`.
    const node = isObj(entry.item) ? (entry.item as Json) : entry;
    const id = String(num(node.Id) ?? str(node.Id) ?? str(node["@id"]) ?? str(node.identifier) ?? "");
    const name = str(node.Name) ?? str(node.name) ?? "";
    if (!id && !name) continue;
    const region =
      str(node.Region) ??
      str(node.State) ??
      (isObj(node.address) ? str((node.address as Json).addressRegion) : undefined);
    const url = str(node.Url) ?? str(node.url);
    out.push({ chain: "event", id, name, ...(region ? { region } : {}), ...(url ? { url } : {}) });
  }
  return out;
}
