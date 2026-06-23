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

## Hoyts — ⚠️ planned (own API, looks open)

- Not Vista. `/Cinemas/GetSessions` → 404.
- Own JSON API host `https://api.hoyts.com.au` (+ Azure APIM `https://apim-aea.hoyts.com.au`),
  `/api/v1/...` routes. Returns clean JSON 404 (`{"statusCode":404,"message":"Resource not found"}`)
  on unknown paths and answered **without** a key — likely open once routes are known.
- TODO: CDP/DevTools network capture of hoyts.com.au booking flow to enumerate the session +
  seat-map routes; confirm whether seat geometry is exposed (premium-class/centre scoring depends
  on it).

## Reading Cinemas — ⚠️ planned (SPA, host unknown)

- React SPA shell (~3KB) for all paths; API lives on another host. TODO: network capture to find
  the API origin + session/seat endpoints.

## Village Cinemas — ⚠️ planned (Cloudflare-gated)

- Next.js app behind Cloudflare ("Just a moment…" 403 on root and `WSVistaWebClient` paths).
  `/Cinemas/GetSessions` returned a Next.js HTML shell, not JSON. TODO: get past CF (Scrapling/
  Patchright) and locate the JSON feed — likely `/_next/data/.../*.json` or a Vista OCAPI behind CF.
