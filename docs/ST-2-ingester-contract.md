# ST-2 Ingester Contract (`packages/ingester`)

Status: frozen for the dual-harness build. Source of truth: `design/seats-together-design.md`
(§Architecture, §Schema, §Core, §Phasing step 2) + `db/schema.sql` (the live 4-table schema).
Mirrors `packages/watcher/src/check.ts` + `cli.ts` for per-session isolation + backoff.

## Purpose
A worker that, per ENABLED row in the `watches` table, sweeps the chain's sessions across the
watch's cinemas × date-range, fetches+scores each session's seat map, and upserts the session row
plus its **available scored seats** into Postgres. One `ingest_runs` row per sweep (dead-man alert
material). One-shot (`ingest --once`) for the checkpoint + a watcher-style scheduled loop.

## Non-negotiable invariants
1. **Available-only.** `session_seats` stores seats with `status === "available"` ONLY. Never store
   sold / spacer / aisle / companion / unavailable seats — a missing column is the adjacency break
   that `findAdjacentBlocks` relies on. (See reconciliation note below re: "in-zone".)
2. **Per-session transaction.** Each session's persist is one DB transaction: upsert the `sessions`
   row, `DELETE` that session's `session_seats`, `INSERT` the fresh available set. A partial failure
   rolls back **only that session** — never a global wipe. Idempotent: re-running yields identical
   row counts (delete+insert, not append).
3. **Per-session isolation + backoff.** One session's `getSeatMap` (or persist) failing must NOT
   abort the watch or the sweep; it is recorded as an error and the sweep continues. Seat-map fetches
   are concurrency-limited (default 4) and bounded per watch (`maxSeatmapsPerWatch`). The loop backs
   off (watcher-style) when a majority of watches fail.
4. **`ingest_runs` accuracy.** Exactly one row per sweep: `started_at` on entry, then on finish
   `finished_at`, `watches` (enabled count processed), `sessions_upserted` (successful upserts),
   `seatmaps_fetched` (successful getSeatMap calls), `errors` (count of recorded errors).
5. **No SQL injection.** All values are passed as parameters (`$1…`), including the multi-row
   `session_seats` insert. No string-interpolated values.
6. **No connection leaks.** Every client checked out of the pool is `release()`d in a `finally`.
7. **Frozen tests / live db safety.** The suite runs against a DISPOSABLE Postgres
   (`DATABASE_URL` env), NEVER the live `seatfinder` db. Adapters are mocked with fixtures — no live
   network in the suite.

### Reconciliation note — "in-zone" vs all-available
The build brief says "AVAILABLE in-zone seats only"; the design doc (source of truth) says store the
**scored available seats** so "party N / minScore Q stay tunable at query time without re-fetching",
and `blocks.ts` filters `score < minScore` itself at query time. Storing only `>= watch.min_score`
would irreversibly discard seats and break downward minScore tunability. Resolution: **store ALL
available scored seats** (a superset the `/together` query filters down). `watch.min_score` is NOT a
storage filter here. This satisfies the available-only invariant and the design's tunability goal.
Flagged for Milo.

## Public API (stable import surface — `@auscinema/ingester`)

### `db.ts`
- `createPool(databaseUrl?: string): pg.Pool` — uses arg ?? `process.env.DATABASE_URL`; throws a
  clear error if neither is set.

### `types.ts`
```ts
interface WatchRow {
  id: number; chain: Chain; cinemaIds: string[];
  dateFrom: string; dateTo: string;            // "YYYY-MM-DD"
  movieId: string | null;                       // null = all movies
  party: number; minScore: number;
  scoring: SeatPreference | null; enabled: boolean;
}
interface SessionUpsert {
  id: string; watchId: number; chain: Chain;
  movieId: string; movieName?: string;
  cinemaId: string; cinemaName?: string;
  date: string;                                 // "YYYY-MM-DD"
  startTime?: string; format?: string; screen?: string;
  seatsAvailable?: number; bookingUrl?: string; seatAllocation?: boolean;
}
interface SeatUpsert {
  seatId: string; rowLabel?: string; row: number; col: number;
  areaKind?: string; score: number;
}
interface SweepError { watchId: number; sessionId?: string; error: string; }
interface IngestCounts { watches: number; sessionsUpserted: number; seatmapsFetched: number; errors: number; }
interface SweepResult { runId: number; watches: number; sessionsUpserted: number; seatmapsFetched: number; errors: SweepError[]; }
```

### `watches.ts`
- `loadEnabledWatches(pool): Promise<WatchRow[]>` — `SELECT … FROM watches WHERE enabled = TRUE
  ORDER BY id`. Maps snake→camel, `cinema_ids text[]`→`string[]`, `movie_id`→`string|null`,
  `scoring jsonb`→`SeatPreference|null`.
- `datesInRange(from: string, to: string): string[]` — inclusive list of `YYYY-MM-DD`, computed in
  UTC (no TZ drift). `from > to` ⇒ `[]`. Guards absurd ranges (> 366 days ⇒ throw).
- `watchToQuery(watch: WatchRow, date: string): SessionQuery` — `{ movieId: watch.movieId ?? "",
  cinemaIds: watch.cinemaIds, date }`. (Empty `movieId` = all movies for every adapter.)

### `sweep.ts`
- `areaKindOf(map: SeatMap, areaId: string): string | undefined`.
- `toSeatUpserts(map: SeatMap, pref?: SeatPreference): SeatUpsert[]` — `scoreAvailableSeats(map,
  pref)` (already `status==="available"` only) mapped to `SeatUpsert`; resolves `areaKind`. All
  available seats, any score.
- `sessionToUpsert(session: Session, watchId: number): SessionUpsert` — maps `Session`→row;
  `date = startTime.slice(0,10)`; `format = format.raw || format.kind`; `screen = screenName`.
- `runSweep(deps: { pool; registry; concurrency?; maxSeatmapsPerWatch? }): Promise<SweepResult>` —
  start run; load enabled watches; per watch: resolve adapter, for each date in range call
  `listSessions` (a per-date `listSessions` throw is recorded and skipped, other dates continue),
  filter `seatAllocation`, de-dupe by id, cap at `maxSeatmapsPerWatch`, then concurrency-limited per
  session: `getSeatMap({preview:true})` → `toSeatUpserts` → `upsertSessionWithSeats`. Per-session
  errors recorded, sweep continues. A watch-level throw (e.g. unknown chain) is recorded against the
  watch. Finish run with counts. Returns `SweepResult`.
- `shouldBackoff(result: { errors: SweepError[] }, totalWatches: number): boolean` — distinct failed
  `watchId` count; `true` when all watches failed or a strict majority failed (mirrors watcher).

### `persist.ts`
- `upsertSessionWithSeats(pool, session: SessionUpsert, seats: SeatUpsert[]): Promise<void>` — one
  txn: `INSERT … ON CONFLICT (id) DO UPDATE` the session (refresh `fetched_at`/`last_seen`),
  `DELETE FROM session_seats WHERE session_id=$1`, parameterized multi-row insert of `seats` (skip
  insert when empty). Rollback on any error; client released in `finally`.
- `startIngestRun(pool): Promise<number>` — `INSERT INTO ingest_runs (started_at) VALUES (now())
  RETURNING id`.
- `finishIngestRun(pool, id: number, counts: IngestCounts): Promise<void>` — `UPDATE ingest_runs SET
  finished_at=now(), watches=$, sessions_upserted=$, seatmaps_fetched=$, errors=$ WHERE id=$`.

### `seed.ts`
- `loadWatchesFile(path): Promise<WatchSeed[]>` — parse `watches.json`.
  `WatchSeed = { chain; cinemaIds; dateFrom; dateTo; movieId?: string|null; party?; minScore?;
  scoring?; enabled? }`.
- `seedWatches(pool, seeds: WatchSeed[]): Promise<{ inserted: number; skipped: number }>` —
  idempotent: insert only if no existing watch matches `(chain, cinema_ids, date_from, date_to,
  movie_id)`; otherwise skip. Defaults: `party=2`, `min_score=74`, `enabled=true`.

### `cli.ts` (bin `auscinema-ingest`)
- `seed [watches.json]` — seed the watches table (path arg ?? `$INGEST_WATCHES` ?? `watches.json`).
- `ingest --once` — one sweep, log summary, exit.
- `ingest` (no `--once`) — loop on `$INGEST_INTERVAL_MS` (default 3_600_000 = hourly) with
  watcher-style exponential backoff on failure.

## Test requirements (numbered — for the frozen suite)
Tests use a disposable Postgres via `DATABASE_URL`; a `before()` applies `db/schema.sql`; each test
TRUNCATEs `watches, sessions, session_seats, ingest_runs RESTART IDENTITY CASCADE`. Adapters are
mocked (a `stubAdapter(sessions, maps)` like `watcher/src/check.test.ts`) and wired into a registry.

1. **datesInRange** — inclusive (`2026-06-24`..`2026-06-26` ⇒ 3 dates); single-day ⇒ 1;
   `from > to` ⇒ `[]`; month/year boundary correct (no TZ off-by-one).
2. **watchToQuery** — `movieId null` ⇒ `query.movieId === ""`; `movieId "M1"` ⇒ `"M1"`.
3. **toSeatUpserts available-only** — a map with available + sold + spacer seats yields rows for the
   **available** seats only (count matches available count); each row carries `score` and resolved
   `areaKind`; sold/spacer seat ids absent.
4. **toSeatUpserts all-sold** — a map with zero available seats ⇒ `[]`.
5. **upsertSessionWithSeats happy path** — after the call: 1 `sessions` row (fields match), and
   `session_seats` count == seats passed; a sample seat row's `score`/`row`/`col` match.
6. **upsert idempotent re-run** — calling twice with the SAME session+seats leaves counts STABLE
   (not doubled): 1 session, N seats.
7. **upsert replaces, not appends** — second call with a DIFFERENT (smaller) seat set replaces the
   first (count == new set; old seat ids gone; session `last_seen` refreshed).
8. **all-sold session persists the session, zero seats** — `upsertSessionWithSeats(session, [])` ⇒
   1 session row, 0 `session_seats`.
9. **runSweep happy** — one enabled watch, stub adapter with 2 sessions each having available seats:
   `sessions_upserted == 2`, `session_seats` populated, `seatmaps_fetched == 2`, `errors == []`;
   exactly one `ingest_runs` row with non-null `finished_at` and matching counts.
10. **runSweep isolation (getSeatMap failure mid-sweep)** — adapter throws for one session, succeeds
    for another: the good session is still upserted, `errors` has one entry for the bad sessionId,
    the sweep does not abort, `ingest_runs.errors == 1`, `sessions_upserted == 1`.
11. **runSweep movieId null vs set** — a watch with `movie_id null` calls `listSessions` with
    `movieId === ""`; a watch with `movie_id` set passes it through (assert via a spy/recording
    stub).
12. **runSweep aisle/sold gap** — a session whose seat map has an aisle (spacer) splitting a row:
    only available seats are stored, so the spacer column is simply absent (assert the stored cols
    have the gap — the spacer's col is not present).
13. **runSweep idempotent** — running the same sweep twice leaves `sessions`/`session_seats` counts
    stable (delete+insert), and produces 2 `ingest_runs` rows.
14. **maxSeatmapsPerWatch cap** — a watch yielding more candidate sessions than the cap fetches at
    most `cap` seat maps (`seatmaps_fetched <= cap`).
15. **shouldBackoff** — distinct-watch counting: all watches failing ⇒ true; one watch with several
    session errors out of many watches ⇒ false; a strict majority failing ⇒ true.
16. **disabled watches skipped** — an `enabled=false` watch is not swept (`loadEnabledWatches`
    excludes it; `sessions_upserted` reflects only enabled).

## Sample seat-map fixture (real shape, Event-normalised)
A row "F" with an aisle (spacer) between col 3 and col 5, two sold seats, the rest available. Spacer
and sold are NOT stored; available cols stored are `{1,2,3,6,7}` (note the gap at 4=spacer, 5=sold).
```json
{
  "chain": "event",
  "sessionId": "S-FIXTURE",
  "screenName": "3",
  "areas": [{ "id": "1", "name": "Stalls", "code": "std", "kind": "standard" }],
  "seats": [
    { "id": "s-f1", "name": "F1", "rowLabel": "F", "row": 5, "col": 1, "status": "available", "areaId": "1" },
    { "id": "s-f2", "name": "F2", "rowLabel": "F", "row": 5, "col": 2, "status": "available", "areaId": "1" },
    { "id": "s-f3", "name": "F3", "rowLabel": "F", "row": 5, "col": 3, "status": "available", "areaId": "1" },
    { "id": "s-f4", "name": "",   "rowLabel": "F", "row": 5, "col": 4, "status": "spacer",    "areaId": "1" },
    { "id": "s-f5", "name": "F5", "rowLabel": "F", "row": 5, "col": 5, "status": "sold",      "areaId": "1" },
    { "id": "s-f6", "name": "F6", "rowLabel": "F", "row": 5, "col": 6, "status": "available", "areaId": "1" },
    { "id": "s-f7", "name": "F7", "rowLabel": "F", "row": 5, "col": 7, "status": "available", "areaId": "1" }
  ]
}
```
`toSeatUpserts` over this ⇒ 5 rows (cols 1,2,3,6,7), each `areaKind === "standard"`.

## Done-when
- Suite green (0 failures) against the disposable Postgres on the NAS.
- Codex adversarial review: no unresolved CRITICAL/HIGH.
- One live `ingest --once` against the live `seatfinder` db writes rows; re-run is idempotent
  (counts stable). Then STOP — no API/UI, no `api` DATABASE_URL wiring.
