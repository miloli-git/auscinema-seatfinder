# ST-3 API contract — `/together` + `/catalog` (DB-backed)

Frozen contract for issue #28. Source of truth for the test-first suite. If a test contradicts this
doc, STOP and reconcile the doc first — do not silently diverge.

Design refs: `design/seats-together-design.md` §Query, §Schema, §Core. Reuses
`@auscinema/core` `findAdjacentBlocks(seats, { minScore, size })` (ST-1) verbatim — do not reimplement
adjacency.

## Non-negotiables
1. `/together` and `/catalog` are **pure DB + cheap compute — NO upstream chain calls** (no adapter
   `listSessions`/`getSeatMap`). They read only `sessions` + `session_seats`.
2. `/seatmap` (and `/best`, `/sessions`, `/cinemas`, `/movies`, `/healthz`) are **UNCHANGED**.
3. Ranking order for `/together` results: **best block `avgScore` DESC, then earliest `startTime` ASC**
   (nulls last), then session `id` ASC as a final stable tiebreak.
4. Empty result is a **200** with `results: []` (never 404, never 500).
5. All dynamic SQL filters are **parameterised** ($1…). No string-interpolated user values. Column
   names are static literals only.
6. The pool is used via `pool.query(...)` only (auto checkout+release) — no manual `pool.connect()` in
   these handlers, so there is no connection-leak path.

## Server construction (test injection)
`buildServer(opts)` gains an optional `pool?: Pool` (a `pg.Pool`). When set, `/together` + `/catalog`
use it. When a `/together`/`/catalog` request arrives and **no pool is configured**, respond **503**
`{ "error": "database not configured" }`.

Tests build the server with an injected pool to a **disposable** Postgres and `rateLimit: false`:
```ts
const server = buildServer({ pool, rateLimit: false, logger: false });
```
Tests MUST refuse to run destructive setup against a db named `seatfinder` (reuse the ingester guard
`assertDisposableDatabase`). Schema applied from `db/schema.sql`; each test seeds its own rows and
`TRUNCATE`s between tests. DB-backed tests are `{ skip: dbSkip }` when `DATABASE_URL` is unset so the
suite still runs (pure cases only) on a box with no DB.

---

## GET /together

Find sessions that have a block of `party` adjacent in-zone seats, swept across the filtered sessions,
ranked best-first. Pure cache read.

### Query params
| param       | required | default | notes |
|-------------|----------|---------|-------|
| `chain`     | yes      | —       | unknown/missing chain string → 400. Filters `sessions.chain`. |
| `movieId`   | no       | —       | filters `sessions.movie_id` when present |
| `cinemaIds` | no       | —       | comma-separated; filters `sessions.cinema_id = ANY(...)`. Blank entries dropped. |
| `dateFrom`  | no       | —       | inclusive lower bound on `sessions.date` (YYYY-MM-DD) |
| `dateTo`    | no       | —       | inclusive upper bound on `sessions.date` (YYYY-MM-DD) |
| `party`     | no       | `2`     | integer party size; values < 1 are clamped to 1; fractional truncated |
| `minScore`  | no       | `74`    | integer in-zone threshold; non-numeric → use default |

`chain` missing/blank → **400** `{ "error": "missing required query param: chain" }`.

### Behaviour
1. Filter `sessions` by the provided scope (chain required; movieId/cinemaIds/dateFrom/dateTo optional),
   all parameterised.
2. Load `session_seats` for the matched sessions (`row_label,row,col,score,seat_id`), map to
   `BlockSeat`, run `findAdjacentBlocks(seats, { minScore, size: party })` per session.
3. Keep only sessions with **≥1 qualifying block**; take that session's **best** block
   (`findAdjacentBlocks` returns best-first, so index 0).
4. Rank results per non-negotiable #3.
5. Hoyts sessions: set `approximateAdjacency: true` (index-order columns → approximate). All other
   chains `false`.

### Response (200)
```json
{
  "party": 2,
  "minScore": 74,
  "count": 2,
  "results": [
    {
      "session": {
        "id": "1234",
        "chain": "event",
        "movieId": "19797",
        "movieName": "The Odyssey",
        "cinemaId": "15",
        "cinemaName": "Event Cinemas George Street",
        "date": "2026-06-25",
        "startTime": "2026-06-25T19:30:00.000Z",
        "format": "V-Max",
        "screen": "3",
        "seatsAvailable": 142,
        "bookingUrl": "https://.../book?sid=1234",
        "seatAllocation": true
      },
      "block": {
        "row": 8,
        "rowLabel": "H",
        "startCol": 10,
        "seatIds": ["s-h10", "s-h11"],
        "avgScore": 96,
        "minScore": 94
      },
      "approximateAdjacency": false,
      "fetchedAt": "2026-06-24T09:00:00.000Z"
    }
  ]
}
```
- `fetchedAt` is the session's `fetched_at` (the "as of" stamp).
- `block` shape is exactly the `SeatBlock` from core (`row,rowLabel,startCol,seatIds,avgScore,minScore`).
- Empty: `{ "party": N, "minScore": Q, "count": 0, "results": [] }`.

---

## GET /catalog

Distinct movies / cinemas / dates currently in the cache, to populate the web pickers. Cheap DB query,
no upstream.

### Query params
| param   | required | notes |
|---------|----------|-------|
| `chain` | no       | when present, scope all three lists to that chain |

### Response (200)
```json
{
  "movies":  [{ "id": "19797", "name": "The Odyssey", "chain": "event" }],
  "cinemas": [{ "id": "15", "name": "Event Cinemas George Street", "chain": "event" }],
  "dates":   ["2026-06-25", "2026-06-26"]
}
```
- `movies` distinct by `(chain, movie_id)`, sorted by `name` then `id`.
- `cinemas` distinct by `(chain, cinema_id)`, sorted by `name` then `id`.
- `dates` distinct `sessions.date` as `YYYY-MM-DD`, sorted ascending.
- Empty DB → all three arrays empty, still **200**.

---

## Numbered test requirements (author against these)
1. `/together` missing `chain` → 400 `{error}`.
2. `/together` with no pool configured → 503 `{error: "database not configured"}`.
3. `/together` happy path: a seeded session with a contiguous in-zone pair returns one result whose
   `block.seatIds` are the adjacent seats, `block.avgScore`/`minScore` correct, `fetchedAt` present,
   `party`/`minScore` echoed, `count === results.length`.
4. Ranking: two qualifying sessions ordered by block `avgScore` DESC; tie on avg broken by earliest
   `startTime` ASC.
5. Multi-cinema: `cinemaIds=a,b` returns results from both; a third cinema's session is excluded.
6. Date-range boundaries: `dateFrom`/`dateTo` are **inclusive**; a session exactly on each bound is
   included; one day outside each bound is excluded.
7. `movieId` filter: only sessions for that movie returned.
8. Party larger than any block (e.g. party=5 when max run is 2) → 200, `results: []`, `count: 0`.
9. `minScore` above every seat's score → 200, `results: []`.
10. No sessions match the filter (unknown movieId) → 200, `results: []`.
11. A matched session with **zero** `session_seats` rows → contributes no result (no crash).
12. `party` default is 2; `minScore` default is 74 when omitted.
13. `party<1` clamped to 1 (a single in-zone seat qualifies as a block of 1).
14. Adjacency break: a column gap (sold/aisle = missing col) inside a row does **not** count as
    adjacent — two seats either side of a gap with party=2 do not form a block.
15. Hoyts session in results carries `approximateAdjacency: true`; an Event result carries `false`.
16. `/catalog` returns distinct movies/cinemas/dates from seeded rows, sorted per spec; dupes collapsed.
17. `/catalog?chain=event` scopes lists to that chain (a hoyts-only movie/cinema/date is excluded).
18. `/catalog` on an empty DB → 200 with three empty arrays.
19. `/catalog` with no pool configured → 503 `{error: "database not configured"}`.
20. SQL-injection attempt in a filter value (e.g. `movieId=1') OR ('1'='1`) returns 200 with no rows
    (value treated as a literal param, not SQL) — proves parameterisation.
</content>
</invoke>
