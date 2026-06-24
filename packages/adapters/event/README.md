# @auscinema/adapter-event

Event Cinemas adapter — the **reference implementation** of `ChainAdapter`. Talks to Event's own
front-end JSON (Vista-style) and normalises it into core `Cinema` / `Session` / `SeatMap` shapes.

## Public API
- `EventCinemasAdapter` (implements `@auscinema/core`'s `ChainAdapter`). Constructor takes an
  optional `{ fetchJson }` for offline tests; defaults to a real fetch with timeout + retry.
  - `chain = "event"`.
  - `listCinemas()` — served from a **bundled dated snapshot** (`data/cinemas.au.json`), so it's
    offline and deterministic (Event's JSON cinema feed is dead).
  - `listSessions({ movieId, cinemaIds, date })` — `GET /Cinemas/GetSessions`. Event ignores the
    `movieId` param and returns every movie at the cinema/date, so the adapter filters client-side
    (empty `movieId` = all movies).
  - `getSeatMap(sessionId, { preview? })` — `GET /Ticketing/Order/GetSeating`.
- `FetchJson` type.

## Geometry
**True coordinates.** Event's `SeatId` encodes row/column ints; the adapter inverts Event's order
to honour the core contract (higher row = further back, col increasing left→right). Scoring is
geometry-correct.

## Used by
Wired into the API + ingester + watcher registries. Request/response detail:
[`../../../docs/endpoints.md`](../../../docs/endpoints.md). Fixtures: `fixtures/`; bundled cinema
list: `data/`.

## Develop
```bash
npm run build -w @auscinema/adapter-event
npm test      -w @auscinema/adapter-event   # tsc -b + node --test (offline fixtures)
```
