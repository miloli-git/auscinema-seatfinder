# Seats Together — handover (resume in a new session)

Last updated 2026-06-24. Read this with `design/seats-together-design.md`, `docs/session-log.md`,
and epic #31 to resume.

## Where we are
Building the **Seats Together** feature (epic **#31**): for a movie, find sessions with N adjacent
seats in the optimal zone, swept across cinemas × dates, served from a cached DB with a live
re-verify on open. Design is locked (`design/seats-together-design.md`).

- **ST-1 (#26) DONE.** `packages/core/src/blocks.ts` — `findAdjacentBlocks(seats, {minScore, size})`
  + 7 tests (`blocks.test.ts`), exported from the core barrel. Core suite 16/16. Geometry-agnostic;
  keeps party-N / minScore tunable at query time.
- **ST-2 (#27) DONE — shipped to `main`.**
  - DB standup (`c104eda`): `db/schema.sql` (4 tables, FK `ON DELETE CASCADE`, `/together` indexes),
    internal-only `db` (postgres:16-alpine) compose service, `.env.example`. Live on NAS, verified.
  - Ingester (`af1fe95`): `packages/ingester` — per-watch sweep (reuses the 4 adapters + watcher
    isolation/backoff), per-session DELETE+INSERT transaction, one `ingest_runs` row per sweep,
    `--once` + scheduled modes, `watches.json` seed. 16/16 tests on a disposable pg. Codex SHIP (R2).
  - **Checkpoint passed** (live `ingest --once`, Event / George St): 60 sessions, 10,207
    session_seats, idempotent re-run (counts stable). Real session data verified.
- **ST-3..5 (#28–#30) TODO.** Next = **ST-3 (#28)**: `/together` + `/catalog` API over the DB +
  wire `api`'s `DATABASE_URL` + `depends_on:[db]`.

## Key facts / gotchas (reality, not plan)
- **`session_seats` stores ALL available *scored* seats** (NOT in-zone-only) so (party N, minScore Q)
  stay tunable at query time. `watch.min_score` is a query-time knob, **not** a storage filter.
  Sold/aisle seats are absent — a column gap = an adjacency break.
- **v1 limitation (known, documented):** `session_seats` has no watch dimension, so if two watches
  ever cover the *same* session with different scoring configs, last-writer-wins by watch id. Fine
  while watches don't overlap (single chain per watch). Revisit only if overlap is needed.
- `api`'s `DATABASE_URL` is **not yet wired** — lands with #28 (avoided bouncing live `api` during
  ST-2). Wiring it in #28 will recreate the live `api` container once (expected).
- The `ingester` compose service is **profile-gated and NOT running** on the live stack — the
  checkpoint was a one-shot `docker compose run --rm`. Scheduling the loop lands in ST-5 (#30) deploy.

## Branch / git state
- ST-1 + ST-2 are on **`main`** (merged at the ST-2 checkpoint, 2026-06-24). App live at
  **https://seatfinder.miloli.org** (NO auth — removed 2026-06-24; Fastify rate-limit still guards
  upstreams). NAS deploy at `/mnt/raptor/claude-projects/seatfinder`, web on port 9015. The `db`
  service is up on the NAS (internal-only); the `seatfinder` db holds the checkpoint rows.
- ST-3 work goes on a fresh branch off `main`.

## ST-3 scope (#28 — what to build next)
- **`GET /together`** — filter `sessions` by chain/movie/cinemas/date-range; join `session_seats`;
  compute `findAdjacentBlocks` for the requested (party, minScore); rank by best block avg then
  earliest start; return block + `fetched_at`. Pure DB + cheap compute, no upstream.
- **`GET /catalog`** — distinct movies / cinemas / dates available in the DB (powers the pickers).
- **`GET /seatmap`** — LIVE, **unchanged** (the on-open confirm).
- **Wire `api`:** `DATABASE_URL` + `depends_on:[db]` in compose (bounces live `api` once — expected).
- Tests against a seeded disposable pg (same NAS pattern the ingester used).
- After #28: **ST-4 (#29)** web "Seats Together" mode; **ST-5 (#30)** schedule the ingester + deploy.

## Codex review harness
Claude Code builds; Codex is the checkpoint reviewer (it can't see Claude's session state, so write a
durable packet before review). Per checkpoint: fill `reviews/checkpoints/<task>.md` (branch/base,
changed files, commands, test output, DB evidence, known gaps, review focus); review packet + diff +
files; re-review after any non-trivial fix; promote only high-signal findings to GitHub issues (raw
review files stay local in `reviews/`).

## Locked decisions (don't relitigate)
- Own Postgres instance in the seatfinder stack (not shared with PriceWatch). DONE.
- Storage = sessions + scored available seats (not fixed blocks) → N/Q tunable at query time. DONE.
- Config-driven watchlist from `watches.json`; hourly per-watch refresh; single chain per watch.
- Hybrid freshness: DB for discovery, LIVE `/seatmap` re-verify on open. `/together` is additive;
  the live tool is untouched.
- Hoyts adjacency is approximate (index-order cols) — label it in results.

## Key paths
- Core fn: `packages/core/src/blocks.ts` (+ `.test.ts`). Scoring: `packages/core/src/scoring.ts`
  (`scoreAvailableSeats`). Adapters: `packages/adapters/{event,hoyts,reading,village}/src/index.ts`.
  Watcher (isolation/backoff reference): `packages/watcher/src/{check,cli}.ts`.
- Ingester: `packages/ingester/src/{types,db,registry,watches,persist,sweep,seed,cli,index}.ts`
  (+ `ingester.test.ts`). Contract: `docs/ST-2-ingester-contract.md`.
- Schema: `db/schema.sql`. Watch seed: `deploy/watches.json`.
- Deploy: `deploy/docker-compose.yml` (+ `.env`, `Caddyfile`). Compose footguns:
  `.claude/memory/reference_compose_caddy_deploy_footguns` ($→$$ in .env; Caddy `handle` blocks).
- Design: `design/seats-together-design.md`. Local-only build log: `docs/session-log.md`.
