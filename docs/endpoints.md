# Reverse-engineered chain endpoints

All undocumented. Personal/educational use, low request rate, no auth. Send a normal browser
`User-Agent`; for Event also send `X-Requested-With: XMLHttpRequest`.

---

## Event Cinemas — ✅ proven, open

Platform: Vista-style, but Event exposes its own front-end JSON (not raw `WSVistaWebClient`).

### Sessions
```
GET /Cinemas/GetSessions?cinemaIds={ids}&movieId={id}&date={YYYY-MM-DD}
```
- `cinemaIds` is **plural**, comma-separated (e.g. `58,5,15`). Singular `cinemaId` is rejected
  with `{"Message":"cinemasIds not provided"}`.
- `movieId` is on the movie page (CDN poster path `/cdn/resources/movies/{id}/...`).
- Response: `Data.Movies[].CinemaModels[].Sessions[]`, each session:
  `Id`, `MovieId`, `CinemaId`, `StartTime` (local, no tz), `ScreenType`/`ScreenTypeName`,
  `ScreenName`, `SeatsAvailable` (live), `SeatAllocation`, `Attributes[]`,
  `BookingUrl` (`.../Orders/Tickets#sessionId={Id}`), `TicketingFlow`.

### Seat map
```
GET /Ticketing/Order/GetSeating?sessionId={id}
```
- Response: `Data.Seats.Rows[]` (each `{RowName, Seats:[...]}`) and `Data.Areas[]`.
- Seat object: `SeatId`, `SeatName` (e.g. "A1"), `Status`, `AreaId`, optional
  `CoupleSeat`, `IsPlatinum`, `Wheelchair`, `RelatedSeats[]`.
- **Status** values seen: `Available`, `Sold`, `Spacer` (aisle/gap — drop), `Companion`, `Special`.
- **SeatId geometry**: `"{areaPadded}|{type}|{ROW}|{COLUMN}"`. The last two ints are the physical
  grid: row constant across a printed row (e.g. row A = `11`), column decreases left→right
  (`20,19,18,...`). Spacers use type `0` and have no real area. Normalise to `Seat.row`/`Seat.col`
  (higher row = further back; col increasing left→right — invert Event's order).
- `Data.Areas[]`: `Id`, `Name` (Double Daybed / Full Recliner / Platinum / Standard...), `Code`,
  colours/images. Map `Code`/`Name` → `SeatArea.kind`.

### Cinemas
```
GET /api/cinemas/JsonLd
```

Fixtures: `packages/adapters/event/fixtures/`.

---

## Hoyts — ✅ proven, open (no auth / no subscription key)

Not Vista. The `www.hoyts.com.au` Vue (Vite) SPA reads its API bases from an embedded
`<script id="config-json">` → `config.urls` object and calls Azure APIM services with a plain
browser `User-Agent` + `Accept: application/json`. **No `Ocp-Apim-Subscription-Key` is required**
for the read endpoints below (route fragments were mined from the Vite chunks under
`/vue/<build>/`, e.g. `chunk-DUm-K_rm.js`).

Bases (`config.urls`):
- `webApi` (cinemas/movies/sessions) = `https://apim-aea.hoyts.com.au/cinemaapi-au-live/api/`
- `ticketingApi` (seat maps)         = `https://apim-aea.hoyts.com.au/ticketing-au-live/api/v1/`
- `orderingApi` = `.../ordering-au-live/api/v1/`, `loyaltyApi` = `.../loyalty-au-live/api/v1/`,
  `walletApi` = `https://api.hoyts.com.au/wallet/` (not needed for read-only seat finding).

### Cinemas
```
GET cinemaapi-au-live/api/cinemas
```
- Open, 200. Bare array: `[{ id:"MIDCIN", slug, name, state, link:"/cinemas/midland-gate",
  features:[...], latitude, longitude, timeZone, address:{...}, ... }]`.
- `id` is an alpha cinema code (e.g. `MIDCIN`, `BROADW`, `BANKTN`), **not** numeric.

### Sessions
```
GET cinemaapi-au-live/api/sessions/{cinemaId}?partnerId=ALL
```
- Open, 200. **Per-cinema, ALL movies + ALL dates — no server-side movie or date filter.**
  Filter client-side. Bare array, each session:
  `id` (int), `cinemaId`, `movieId` (= the **Vista id** `HO00008574`, matches `vistaId` in
  `/movies/now-showing`), `date` (local, no tz), `utcDate`, `typeId`
  (`STANDARD`/`XTREME`/`LUX`/...), `originalTags[]`, `allocatedSeating`, `discount`,
  `screenName`, `operator`, `link` (`/orders/tickets?cinemaId=..&sessionId=..`).
- No `seatsAvailable` count in this feed.

### Seat map
```
GET ticketing-au-live/api/v1/ticket/seats/{cinemaId}/{sessionId}/
```
- Open, 200. **Keyed on BOTH cinemaId and sessionId** (session ids are cinema-scoped — a valid
  sessionId under the wrong cinema returns `410 {"title":"Session sold out."}`). Shape:
  `{ areas:[{id,code,name}], rows:[ { name:rowLabel, seats:[ Slot ] } ] }`.
- `Slot` is one of: a **seat** `{areaId,name,number,rowNumber,id,typeId,sold?,unavailable?}`,
  a **gap** `{typeId:"gap"}`, or a **group** `{group:[seat,seat],typeId}` (paired daybeds/lounges).
  `sold`/`unavailable` appear **only when true**; an absent flag = available.
- `typeId` seen: `daybed`, `recliner`, `lounge`, `wheelchair`, `standard`, `gap`.
  `areas[].name`: `Daybed`, `Recliner`, `Standard`, `Lounge`, `Platinum`/`LUX`...
- A fully sold-out session returns `410 "Session sold out."` for the whole map.

### Seat-geometry verdict — ⚠️ NO explicit coordinates (index-based, approximate)
Hoyts exposes **no row/column coordinates**. Physical position is implicit in array **order**:
rows are listed front(screen)→back, seats left→right within each row (gaps included). The SPA
itself computes the auditorium centre from array indices (`(cols-1)/2`, `(rows-1)/2`), so the
adapter mirrors that: `row` = row index (front = 0, higher = further back), `col` = running slot
index within the row (gaps and each group member consume a slot). **Centre/depth scoring works for
Hoyts but is approximate (index-based, not metric)** — good enough and consistent with Hoyts' own
layout. `Seat.name`/`number` give the printed label; `id` is the opaque seat id for booking.

### Adapter status
`HoytsAdapter` **implemented** — `packages/adapters/hoyts/`. Because `getSeatMap(sessionId)` only
receives a session id but the seat route needs the cinema too, `Session.id` is encoded as
`"{cinemaId}:{sessionId}"` and split back in `getSeatMap`. Fixtures: `packages/adapters/hoyts/
fixtures/` (`cinemas.json`, `sessions.midcin.json`, `seats.midcin-58337.json` (daybed groups +
wheelchair), `seats.broadw-456373.json` (recliner singles + sold)). Offline `node --test` parses
them; `npm test -w @auscinema/adapter-hoyts` is green.

## Reading Cinemas — ⚠️ planned (SPA, host unknown)

- React SPA shell (~3KB) for all paths; API lives on another host. TODO: network capture to find
  the API origin + session/seat endpoints.

## Village Cinemas — ⚠️ planned (Cloudflare-gated)

- Next.js app behind Cloudflare ("Just a moment…" 403 on root and `WSVistaWebClient` paths).
  `/Cinemas/GetSessions` returned a Next.js HTML shell, not JSON. TODO: get past CF (Scrapling/
  Patchright) and locate the JSON feed — likely `/_next/data/.../*.json` or a Vista OCAPI behind CF.
