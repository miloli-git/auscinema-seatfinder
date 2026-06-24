# @auscinema/core

The chain-agnostic heart of the monorepo: domain types, the `ChainAdapter` contract, the seat
scorer, and the adjacency search. Has **no runtime dependencies**. Every other package depends on
this one; nothing here depends on a specific chain.

## What it exports

Barrel re-exports from `src/index.ts` (`types`, `adapter`, `scoring`, `blocks`, `errors`).

### Types (`src/types.ts`)
- `Chain` — `"event" | "hoyts" | "reading" | "village"`.
- `Cinema`, `Session`, `ScreenFormat` — normalised listing shapes.
- `Seat`, `SeatArea`, `SeatStatus`, `SeatMap` — normalised auditorium layout. `Seat.row`/`col` are
  normalised coordinates: **higher `row` = further back, `col` increases left→right**, regardless
  of how the chain encodes its raw layout.

### Adapter contract (`src/adapter.ts`)
- `ChainAdapter` — the one interface every chain implements: `listCinemas()`,
  `listSessions(query)`, `getSeatMap(sessionId, opts?)`.
- `SessionQuery` — `{ movieId, cinemaIds: string[], date }`.

### Scoring (`src/scoring.ts`)
Pure functions, geometry from the `SeatMap` (real seats only; spacers dropped):
- `scoreSeat(seat, map, pref?) → number` — 0–100 for one seat. Gate on availability + allowed area
  kinds, then weighted depth penalty (`|depth − targetDepth|`) + centrality penalty (distance from
  row centre). `SeatPreference` defaults: `targetDepth 0.65`, `depthWeight 0.5`,
  `centralityWeight 0.5`.
- `isSeatEligible(seat, map, pref?) → boolean` — the gate alone.
- `rankSeats(map, pref?) → ScoredSeat[]` — eligible seats, best-first.
- `scoreAvailableSeats(map, pref?) → ScoredSeat[]` — all available seats scored, best-first (used
  for display and by the ingester).
- `bestSeatScore(map, pref?) → number` — top seat score (or 0); ranks sessions against each other.

See [`../../docs/scoring.md`](../../docs/scoring.md) for the model.

### Adjacency — Seats Together (`src/blocks.ts`)
- `findAdjacentBlocks(seats, { minScore, size }) → SeatBlock[]` — given the available, scored seats
  of a session, finds the best contiguous run of `size` seats per row where every seat is in-zone
  (`score >= minScore`). Walks each row by ascending `col`; a break is a column gap (sold/aisle, so
  absent from input) or a below-threshold seat. Returns blocks sorted best-first (avgScore desc,
  then row, then startCol). Geometry-agnostic — works for true-coordinate chains and Hoyts'
  index-order columns alike (Hoyts adjacency is approximate). Inputs are `BlockSeat`, outputs
  `SeatBlock` (`{ row, rowLabel, startCol, seatIds, avgScore, minScore }`).

### Errors (`src/errors.ts`)
- `UpstreamError` (+ `UpstreamErrorKind`) — typed chain-failure error every adapter throws so the
  API can map to a meaningful status (502 upstream / 503 timeout) instead of a blanket 500.
- `isAbortError(err) → boolean` — true for an `AbortController` fetch timeout.

## How it's used
Adapters implement `ChainAdapter` and emit core `SeatMap`s. The API and watcher score with
`rankSeats` / `bestSeatScore`; the ingester scores with `scoreAvailableSeats` and precomputes with
`findAdjacentBlocks`, which the API's `/together` query also runs over `session_seats`.

## Develop
```bash
npm run build -w @auscinema/core   # tsc -b
npm test  -w @auscinema/core       # node --test (scoring.test.ts, blocks.test.ts)
```
