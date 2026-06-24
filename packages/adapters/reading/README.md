# @auscinema/adapter-reading

Reading Cinemas adapter. Reading is Vista behind an AWS API-Gateway + Lambda facade
(`prod-api.readingcinemas.com.au`). Normalises into core shapes.

## Auth — public bootstrap bearer token
Every data route sits behind a Lambda authorizer. The adapter boots by calling `GET /settings/1`,
which returns a short-lived public Cognito token, and sends it as `Authorization: Bearer <token>`
on every other call. The token is cached per adapter instance (no login, no subscription key).

## Public API
- `ReadingAdapter` (implements `ChainAdapter`). Constructor takes optional `{ fetchJson }` (the
  injectable fetch supports `GET`/`POST` + token, since the seat map is a POST).
  - `chain = "reading"`.
  - `listCinemas()` — `GET /getcinemas?countryId=1`. Cinema id is the `slug` (e.g. `auburn`).
  - `listSessions({ movieId, cinemaIds, date })` — `GET /films?...` per-cinema (all movies + dates),
    filtered client-side.
  - `getSeatMap(sessionId, { preview? })` — `POST /ticketing/tickettypes` (seatPlan). The seat route
    needs cinema + screenType + reservedSeating, so `Session.id` is encoded
    `"{cinemaId}|{sessionId}|{screenType}|{reservedSeating}"` and split back here.
- `FetchJson` / `FetchInit` types.

## Geometry — true coordinates
Each seat carries explicit Vista `row` / `column` ints. Vista numbers both descending; the adapter
negates both so core gets higher = further back, col increasing left→right. Scoring is
geometry-correct.

## Used by
Wired into the API + ingester + watcher registries. Detail:
[`../../../docs/endpoints.md`](../../../docs/endpoints.md). Fixtures: `fixtures/`.

## Develop
```bash
npm run build -w @auscinema/adapter-reading
npm test      -w @auscinema/adapter-reading   # tsc -b + node --test (offline fixtures)
```
