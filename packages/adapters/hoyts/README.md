# @auscinema/adapter-hoyts

Hoyts adapter. Hoyts is **not** Vista — its Vue SPA reads Azure APIM JSON services (no auth, no
subscription key for the read endpoints). Normalises into core shapes.

## Public API
- `HoytsAdapter` (implements `ChainAdapter`). Constructor takes optional `{ fetchJson }`.
  - `chain = "hoyts"`.
  - `listCinemas()` — `GET cinemaapi-au-live/api/cinemas`. Cinema id is an alpha code (e.g.
    `MIDCIN`), not numeric.
  - `listSessions({ movieId, cinemaIds, date })` — `GET .../sessions/{cinemaId}?partnerId=ALL`,
    per-cinema with ALL movies + dates, filtered client-side.
  - `getSeatMap(sessionId, { preview? })` — `GET ticketing-au-live/.../ticket/seats/{cinemaId}/{sessionId}/`.
    The seat route needs the cinema too, so `Session.id` is encoded `"{cinemaId}:{sessionId}"` and
    split back here.
- `FetchJson` type.

## Geometry — approximate
Hoyts exposes **no row/column coordinates**. Position is implicit in array order (rows front→back,
seats left→right within a row); the adapter mirrors the SPA's index-based centre. **Depth/centrality
scoring works but is approximate, and Seats-Together adjacency is index-order — labelled as
approximate in results.**

## Used by
Wired into the API + ingester + watcher registries. Detail:
[`../../../docs/endpoints.md`](../../../docs/endpoints.md). Fixtures: `fixtures/`.

## Develop
```bash
npm run build -w @auscinema/adapter-hoyts
npm test      -w @auscinema/adapter-hoyts   # tsc -b + node --test (offline fixtures)
```
