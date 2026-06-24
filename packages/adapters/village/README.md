# @auscinema/adapter-village

Village Cinemas adapter. Village is a Cloudflare-fronted Next.js site, but the CF interstitial only
guards the document routes — the `/api/...` route handlers + an Algolia session index answer a plain
browser `User-Agent` with no challenge or auth. Backend is Vista. Normalises into core shapes.

## Public API
- `VillageAdapter` (implements `ChainAdapter`). Constructor takes optional `{ fetchJson }`
  (GET-only; no token, no POST).
  - `chain = "village"`.
  - `listCinemas()` — dedupes the `cinema` objects out of one unfiltered
    `GET /api/algolia/sessions/hits` call (no dedicated all-cinemas route). Cinema id is the Vista
    3-digit site code (e.g. `027`); `movieId` is the Vista HO code (`movieHoCode`).
  - `listSessions({ movieId, cinemaIds, date })` — `GET /api/algolia/sessions/hits` with `f.c` /
    `f.m` / `f.d` facet filters (repeated param ORs within a facet, different facets AND).
  - `getSeatMap(sessionId, { preview? })` — `GET /api/session/seat-map?cinemaId=&sessionId=`. The
    seat route needs both ids, so `Session.id` is encoded `"{cinemaId}|{sessionId}"` and split here.
- `FetchJson` type.

## Geometry — true coordinates
Each seat carries `position.row` / `position.column` ints. Vista numbers both descending; the
adapter negates both so core gets higher = further back, col increasing left→right. Structural gaps
(`status:-1`, empty `seatId`) map to `spacer` so column geometry stays aligned. Scoring is
geometry-correct.

## Used by
Wired into the API + ingester + watcher registries. Detail:
[`../../../docs/endpoints.md`](../../../docs/endpoints.md). Fixtures: `fixtures/`.

## Develop
```bash
npm run build -w @auscinema/adapter-village
npm test      -w @auscinema/adapter-village   # tsc -b + node --test (offline fixtures)
```
