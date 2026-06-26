# Architecture

`auscinema-seatfinder` is an npm-workspaces monorepo (Node 20+, ESM + TypeScript). One
chain-agnostic core, one adapter per cinema chain behind a single interface, a Fastify API, two
workers, and a React SPA. Scoring and UI are written once and serve every chain.

## Package layout

```
packages/
  core/                @auscinema/core         types + ChainAdapter interface + scorer + adjacency + UpstreamError
  adapters/
    event/             @auscinema/adapter-event     reference adapter (true geometry, bundled cinemas)
    hoyts/             @auscinema/adapter-hoyts      Azure APIM JSON; index-order geometry (approx adjacency)
    reading/           @auscinema/adapter-reading    Vista via AWS API-Gateway facade; bootstrap bearer token
    village/           @auscinema/adapter-village    Vista via Next.js handlers + Algolia session index
  api/                 @auscinema/api          Fastify: cache, rate-limit, /seatmap (live) + /together /catalog (cached)
  ingester/            @auscinema/ingester     scheduled sweep worker -> Postgres (Seats Together)
  watcher/             @auscinema/watcher      optional alert poller -> webhook
apps/
  web/                 @auscinema/web          Vite + React SPA
```

The dependency direction is one-way: adapters, api, ingester and watcher all depend on
`@auscinema/core`; nothing depends back on a chain's raw payloads. `core` has no runtime deps.

## The seam: `ChainAdapter`

Defined in `packages/core/src/adapter.ts`. Every chain is reduced to:

```ts
interface ChainAdapter {
  readonly chain: Chain;                                  // "event" | "hoyts" | "reading" | "village"
  listCinemas(): Promise<Cinema[]>;
  listSessions(query: SessionQuery): Promise<Session[]>;  // { movieId, cinemaIds[], date }
  getSeatMap(sessionId: string, opts?: { preview?: boolean }): Promise<SeatMap>;
}
```

Both the API registry and the ingester registry instantiate the four adapter classes
(`EventCinemasAdapter`, `HoytsAdapter`, `ReadingAdapter`, `VillageAdapter`) into a
`Partial<Record<Chain, ChainAdapter>>`. Adapters take an injectable `fetchJson` so tests run
offline against fixtures.

Each adapter normalises its chain's raw layout into the core `SeatMap` / `Seat` shape (higher `row`
= further back, `col` increases left→right). Several chains key their seat-map route on more than a
session id, so they pack the extra ids into `Session.id` (e.g. Hoyts `"{cinemaId}:{sessionId}"`,
Reading `"{cinemaId}|{sessionId}|{screenType}|{reservedSeating}"`, Village `"{cinemaId}|{sessionId}"`)
and split it back inside `getSeatMap`. Per-chain request/response details are in
[`endpoints.md`](endpoints.md); the scoring model in [`scoring.md`](scoring.md).

## Mode 1 — live seat quality (shipped)

```
browser (SPA)                api (Fastify)                 adapter                 chain backend
   │  pick movie/cinemas/date    │                            │                        │
   │  + seat prefs               │                            │                        │
   ├────────────────────────────▶│  listSessions(query) ─────▶│  HTTP (preview) ──────▶│
   │                             │◀─── Session[] ─────────────┤                        │
   │                             │  getSeatMap(sessionId) ───▶│  HTTP ────────────────▶│
   │                             │◀─── SeatMap ───────────────┤                        │
   │                             │  rankSeats / scoreAvailableSeats (core)             │
   │◀── ranked sessions + scored seat map ─┤                  │                        │
   │  open booking flow on the chain's own page ─────────────────────────────────────▶│
```

The API holds an in-memory session cache and a per-IP rate limit so the browser never hits the
chains directly (sidesteps CORS and bot walls). Scoring is pure (`packages/core/src/scoring.ts`):
gate on availability + allowed area kinds, then a weighted depth + centrality penalty → 0–100.

## Mode 2 — Seats Together (cached cross-cinema discovery, in progress)

A live sweep is too expensive, so a scheduled worker precomputes into Postgres and the API serves
queries from cache, re-verifying live only on open.

```
deploy/watches.json ──seed──▶ Postgres.watches
                                  │
        ┌─────────────────────────┴──────────────────────────┐
        │  ingester (scheduled worker, reuses the 4 adapters) │
        │  per enabled watch, per date in range:              │
        │    listSessions ▶ for each session: getSeatMap ▶ score (scoreAvailableSeats)
        │    DELETE+INSERT the session + its scored AVAILABLE seats (one tx)
        │    one ingest_runs row per sweep; per-session isolation + backoff
        └─────────────────────────┬──────────────────────────┘
                                  ▼
                              Postgres
                  watches · sessions · session_seats · ingest_runs
                                  │
                    ┌─────────────┴──────────────┐
                    │  api (Fastify, DB-backed)   │
                    │   GET /catalog   distinct movies/cinemas/dates in the DB
                    │   GET /together  filter sessions, join session_seats,
                    │                  findAdjacentBlocks(party, minScore), rank
                    │   GET /seatmap   LIVE, unchanged — the on-open confirm
                    └─────────────┬──────────────┘
                                  ▼
                    web "Seats Together" mode: catalog pickers ▶ instant /together ▶
                    open a result ▶ live /seatmap confirm with the block highlighted ▶ book
```

Live-reality notes (from `docs/seats-together-handover.md`):

- **`session_seats` stores ALL available *scored* seats**, not in-zone-only — so party size `N`
  and `minScore` stay tunable at query time without re-fetching. `watch.min_score` is a query-time
  knob, **not** a storage filter. Sold/aisle seats are absent, so a column gap reads as an
  adjacency break.
- **Hoyts adjacency is approximate.** Hoyts exposes no metric coordinates; `col` is array-order
  index, so contiguity is index-order, not measured — labelled in results.
- **Ingester scheduling is not yet live.** ST-1 (core `findAdjacentBlocks`) and ST-2 (schema +
  ingester) are shipped to `main`; the `db` service is up on the NAS (internal-only). The API's
  `DATABASE_URL` wiring and `/together` / `/catalog` land with ST-3; the ingester loop is run
  one-shot for now (`docker compose run --rm`), scheduled in ST-5.

The full Postgres schema, watch model, and phasing are in
[`../design/seats-together-design.md`](../design/seats-together-design.md) — not restated here.

## Workers

- **Ingester** (`packages/ingester`) — the Seats Together sweep above. Postgres-backed; reuses the
  adapters via its own registry to stay decoupled from the watcher.
- **Watcher** (`packages/watcher`) — independent, optional alert path. Polls a JSON-configured set
  of saved queries on an interval, scores the best seat per session, and fires a webhook
  (Discord-style) when a session crosses the configured score threshold. Local JSON state file
  tracks what's already been alerted. Not part of the Seats Together pipeline.

## Build & test

`tsc -b` project references stitch the workspaces together (`tsconfig.base.json` + per-package
`tsconfig.json`). `npm test` runs each package's `node --test` suite against offline fixtures;
`npm run smoke` runs `scripts/smoke.ts` against live backends (not CI). See the root
[`README.md`](../README.md) for commands and [`../deploy/README.md`](../deploy/README.md) for the
compose stack.
