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

### Cinemas — ⚠️ JSON feed dead; use a dated HTML snapshot
`GET /api/cinemas/JsonLd` now returns an empty `@graph` (98 bytes, no data) — broken/deprecated.
The live cinema list (54 AU cinemas, numeric ids) exists only in the **`/Cinemas` page HTML**:
each is a tag `id="cinema-select_{ID}_checkbox"` carrying `data-name`, `data-url`, `data-lat`,
`data-long`. The numeric `{ID}` is the `cinemaId` used by `GetSessions` (e.g. 58 = Burwood).
The adapter serves a **bundled dated snapshot** at `packages/adapters/event/data/cinemas.au.json`
(`capturedAt`); refresh by re-scraping `/Cinemas`. `listCinemas()` is therefore offline/deterministic.

Fixtures: `packages/adapters/event/fixtures/`. Cinema reference: `packages/adapters/event/data/`.

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

## Reading Cinemas — ✅ implemented (Vista behind an AWS API-Gateway facade)

The readingcinemas.com.au React SPA (~3KB shell) reads `API_BASE_URL` from its `main.*.js` bundle:
**`https://prod-api.readingcinemas.com.au`**. This is an AWS API-Gateway + Lambda facade over Vista
(`data.settings.VistaUrl` = `prod-au-vista.readingcinemas.com.au`). The same API serves NZ/Angelika/
State/US via `countryId` (AU=1, NZ=2, Angelika=3, State=4, US=5).

### Auth — public bootstrap bearer token (no login, no subscription key)
Every data route is behind a Lambda authorizer (raw `getcinemas` returns `401 {"Unauthorized"}`). The
SPA boots by calling **`GET /settings/{countryId}`**, which returns a short-lived public Cognito access
token at `data.settings.token`. That token is sent as `Authorization: Bearer <token>` on every other
call. We fetch + cache it per adapter instance. Send a browser `User-Agent` + `Accept: application/json`.

### Endpoints (all require the bearer token)
- `GET /settings/1` → `{ data:{ settings:{ token, VistaUrl, defaultCinema, ... } } }` — bootstrap.
- `GET /getcinemas?countryId=1` → `[ { slug, name, state, stateCode, latitude, prices, … } ]`. The
  **cinema id is `slug`** (e.g. `auburn`); it keys the session + seat routes. 27 AU cinemas.
- `GET /films?countryId=1&cinemaId={slug}&status=nowShowing` →
  `{ data:[ { name, slug(=SPA film id), showdates:[ { date, showtypes:[ { type, amenities,
  showtimes:[ { id, ScheduledFilmId(=Vista film id), date_time(+offset), auditorium, reservedSeating,
  availableSeats, totalNumberOfSeats, type, soldout } ] } ] } ] } ] }`. Per-cinema feed carries ALL
  movies + ALL dates; filter client-side by movie + date (cf. Hoyts). `ScheduledFilmId` is the portable
  movie id; `slug` is the SPA film id used in the booking deep-link `/sessions/{sessionId}/{filmSlug}`.
- `POST /ticketing/tickettypes` body
  `{ cinemaId, sessionId, reservedSeating, requestType:"seatPlan", covidFlag:0, countryId:"1",
  screenType, showLoyaltyTicket:true }` →
  `{ data:{ ticketType:[…], seatLayout:[ rowObj{ "0":SeatCell,… } ], seatLayoutCategory:{cat:[rowIdx…]} } }`.
  `requestType:"ticketTypesLength"` returns only a count; `requestType:"seatPlan"` returns the layout.
  `SeatCell = { seatType:"Empty"|"Aisle"|"Sold"|"Companion"|"Special"|"Broken"|…, seatId, isAvailable,
  isBooked, row, column, areaNumber, category, areaCategoryCode }`.

### Geometry — EXPOSED (explicit grid coordinates)
Each seat carries explicit Vista `row` and `column` ints — true geometry, not array order. Vista numbers
`row` front→back **descending** (front row = highest) and `column` left→right **descending**; the adapter
negates both so core gets higher=further-back and col increasing left→right (same encoding as Event).
`seatType` "Empty" = a selectable seat; "Aisle" = structural gap → mapped to `spacer`. Status map:
isBooked/"Sold"→sold, "Companion"→companion, "Special"→special, "Broken"/"House"→unavailable.

### Adapter status
`ReadingAdapter` **implemented** — `packages/adapters/reading/`. `Session.id` is encoded as
`"{cinemaId}|{sessionId}|{screenType}|{reservedSeating}"` so `getSeatMap` can rebuild the seatPlan POST
(the seat route needs more than a session id — cf. Hoyts). Areas are keyed by Vista `areaCategoryCode`.
Fixtures: `packages/adapters/reading/fixtures/` (`settings.json` token-bootstrap, `cinemas.json`,
`sessions.belmont.json`, `seats.belmont-190163.json` (Sold/Companion/Special/Broken/Aisle/Empty),
`seats.auburn-128342.json`). Offline `node --test` parses them; `npm test -w @auscinema/adapter-reading`
is green. Verified live end-to-end: 27 cinemas → sessions → 112-seat map with geometry.

## Village Cinemas — ✅ implemented (Cloudflare guards the SPA, NOT the JSON API)

`villagecinemas.com.au` is a Next.js (App Router) site fronted by Cloudflare, but **the CF
interstitial only guards the document routes** (and the legacy `WSVistaWebClient`/`/Cinemas/...`
paths — which are dead anyway). The site's own **JSON route handlers under `/api/...` answer a plain
browser `User-Agent` with no challenge, no auth, no subscription key.** No stealth browser was
needed. The backend is Vista (payment widget host `villag-wpm.app.vista.co`), surfaced through
Next.js route handlers plus an **Algolia** "sessions" search index. Endpoint paths + the Algolia
facet-param map were mined from the JS chunks (`baseUrl:"/api"` RTK slice; endpoint enum
`SEAT_MAP`/`ALGOLIA_SESSIONS_HITS`/...; facet code map `{cinemaIds:"c",dates:"d",movieHoCodes:"m",
experiences:"x",...}` with the `f.` prefix). Send a browser `User-Agent` + `Accept: application/json`.

Ids: **cinema id is the Vista 3-digit site code** (e.g. `027` Albury, `272` Airport West, `351`).
**movieId is the Vista HO code** `movie.movieHoCode` (e.g. `HO00016727`) — the portable movie id.

### Sessions — Algolia index proxy (open)
```
GET /api/algolia/sessions/hits[?f.c={cinemaId}&f.c={cinemaId2}&f.m={movieHoCode}&f.d={YYYY-MM-DD}]
```
- Open, 200. Response `{ hits:[ Hit ], nbHits, nbPages, page }`. **Unfiltered returns ALL sessions
  (~11k, capped at 1000 per call)**; pass facet filters to narrow server-side. Facet param =
  `f.<code>`: `c`=`cinema.cinemaId`, `m`=`movie.movieHoCode`, `d`=`date`,
  `x`=`experience.vistaAttributeCode`. **Repeating a param ORs values within a facet; different
  facets AND** — so one call with every `f.c` plus `f.m`+`f.d` returns exactly the wanted sessions.
- `Hit`: `sessionId`, `showtime` (local ISO + offset, e.g. `2026-06-24T15:30:00.000000+10:00`),
  `date`, `seatsAvailable` (live), `isAllocatedSeating` (false ⇒ unreserved, seat map skipped),
  `experience` (`{vistaAttributeCode, label}` — Standard/Gold Class/IMAX/Vmax/Vpremium/4DX/...),
  `seatingAttributes`/`secondaryAttributes`, and the **full `cinema` object** (`cinemaId`, `name`,
  `suburb`, `state`, `address`, `coordinates`, `cinemaOperatorCode`) + **full `movie`**
  (`movieHoCode`, `title`, ...). No screen/auditorium label in the feed.
- A companion facets feed exists at `/api/algolia/sessions/facets` (counts only, no names) — not
  needed; the hits feed carries everything.

### Cinemas — derived from the hits feed (no dedicated all-cinemas route)
There is no plain "list all cinemas" JSON route (`/api/cinema/get-cinemas-by-movie` requires a
movie). Instead **`listCinemas` dedupes the `cinema` objects out of one unfiltered hits call** — all
**23 AU cinemas** appear within the first 1000 hits (cross-checked against the facets' distinct
`cinema.cinemaId` set: identical 23).

### Seat map — Vista layout (open)
```
GET /api/session/seat-map?cinemaId={cinemaId}&sessionId={sessionId}
```
- Open, 200. **Keyed on BOTH cinemaId + sessionId.** Bare **array of areas**:
  `[{ areaCategoryCode, areaNumber, description, rows:[ { physicalName, id, name, seats:[ Cell ] } ] }]`.
- `Cell`: `{ id, seatId(e.g. "A5"), row(label "A"), position:{ row:int, column:int }, status:int,
  seatStatus:"available"|"unavailable", description, areaCategoryCode, isStandard, isWheelChair,
  isCarerSeat, isRecliner, isLounge, isSofa, isDayBed, isBeanBag }`.
- Status: `seatStatus:"available"` ⇒ available; `seatStatus:"unavailable"` on a **real seat**
  (has `seatId`, `status:0`) ⇒ **sold/booked**; `isCarerSeat` ⇒ companion. **Structural gaps/aisles**
  are cells with `status:-1`, empty `seatId`, id like `"A-empty-1"` ⇒ mapped to `spacer`.
  Missing/bogus `sessionId` returns `[]`; missing required params returns `400 {"title":"Input error"}`.

### Geometry — EXPOSED (explicit grid coordinates)
Each seat carries `position.row` and `position.column` ints — true geometry, not array order. Vista
numbers `position.row` front→back **DESCENDING** (front row = highest) and `position.column`
left→right **DESCENDING**; the adapter negates both so core gets higher=further-back and col
increasing left→right (same encoding as Event/Reading). Scoring is geometry-correct, not approximate.

### Adapter status
`VillageAdapter` **implemented** — `packages/adapters/village/`. GET-only injectable `fetchJson`
(no token, no POST). The seat route needs cinemaId + sessionId but `getSeatMap` only receives a
session id — so `Session.id` is encoded as `"{cinemaId}|{sessionId}"` and split back there
(cf. Hoyts/Reading). Areas keyed by Vista `areaCategoryCode`. Fixtures:
`packages/adapters/village/fixtures/` (`sessions.json` (5 hits over 2 cinemas, movie+date filtered),
`seats.albury-400853.json` (available/sold/spacer/wheelchair/carer), `seats.vpremium-329077.json`).
Offline `node --test` parses them; `npm test -w @auscinema/adapter-village` is green; wired into the
API + watcher registries. **Verified live end-to-end: 23 cinemas → 395 sessions @ cinema 027 →
112-seat map with geometry (79 available / 10 sold / 21 spacers / 2 companion).**
