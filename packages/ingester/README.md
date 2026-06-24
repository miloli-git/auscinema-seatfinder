# @auscinema/ingester

Scheduled sweep worker for the **Seats Together** feature. Reads the `watches` table, reuses the
four chain adapters to list sessions and fetch + score seat maps, and upserts sessions plus their
scored available seats into Postgres so the API can serve cross-cinema adjacency queries from cache.
See [`../../design/seats-together-design.md`](../../design/seats-together-design.md).

## CLI (`auscinema-ingest`)

`DATABASE_URL` is read from the environment. Watches file path resolves
`argv[3]` → `$INGEST_WATCHES` → default.

```bash
npm run seed       -w @auscinema/ingester   # seed the watches table from watches.json (idempotent)
npm run ingest:once -w @auscinema/ingester  # one sweep, then exit (the checkpoint entrypoint)
npm run ingest     -w @auscinema/ingester   # loop on $INGEST_INTERVAL_MS (default hourly), backing off
```

(Underlying commands: `node dist/cli.js seed|ingest [--once]`.)

## Public API (barrel `src/index.ts`)

Re-exports `types`, `db`, `registry`, `watches`, `persist`, `sweep`, `seed`:

- `createPool(databaseUrl?)` (`db.ts`) — pg `Pool`; `Pool` type re-exported.
- `defaultRegistry()` / `resolveAdapter(registry, chain)` (`registry.ts`) — chain → adapter map
  (its own copy, to stay decoupled from the watcher).
- `loadEnabledWatches(pool)`, `watchToQuery(watch, date)`, `datesInRange(from, to)` (`watches.ts`).
- `runSweep(deps) → SweepResult`, `shouldBackoff(result, totalWatches)`, plus
  `toSeatUpserts(map, pref?)`, `sessionToUpsert(session, watchId)`, `areaKindOf(map, areaId)`
  (`sweep.ts`).
- `upsertSessionWithSeats(...)`, `startIngestRun(pool)`, `finishIngestRun(pool, id, counts)`
  (`persist.ts`).
- `loadWatchesFile(path)`, `seedWatches(pool, seeds)`, `WatchSeed` (`seed.ts`).
- `WatchRow`, `SessionUpsert`, `SeatUpsert`, `SweepError`, `IngestCounts`, `SweepResult`
  (`types.ts`).

## Behaviour / gotchas
- Per enabled watch, per date in range: `listSessions`, then `getSeatMap` + `scoreAvailableSeats`
  per session, then a per-session DELETE+INSERT transaction (`upsertSessionWithSeats`). One
  `ingest_runs` row per sweep. Per-session isolation + backoff (watcher lessons reused).
- **`session_seats` stores ALL available scored seats** (not in-zone-only), so party size and
  `minScore` stay tunable at query time. `watch.min_score` is a query knob, not a storage filter.
- v1: `session_seats` has no watch dimension — if two watches cover the same session with different
  scoring, last-writer-wins by watch id. Fine while watches don't overlap (single chain per watch).
- The compose `ingester` service is profile-gated and **not yet scheduled** on the live stack;
  sweeps have been run one-shot (`docker compose run --rm`). Scheduling lands in ST-5.

## Used by
The API's `/together` / `/catalog` endpoints read the tables this worker populates. Schema:
`db/schema.sql`. Watch seed: `deploy/watches.json`. Contract: `docs/ST-2-ingester-contract.md`.

## Develop
```bash
npm run build -w @auscinema/ingester
npm test      -w @auscinema/ingester   # tsc -b + node --test (needs a disposable Postgres)
```
