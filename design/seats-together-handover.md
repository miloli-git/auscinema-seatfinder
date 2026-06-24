# Seats Together — handover (resume in a new session)

Last updated 2026-06-24. Read this + `design/seats-together-design.md` + epic #31 to resume.

## Where we are
Building the **Seats Together** feature (epic **#31**): for a movie, find sessions with N adjacent
seats in the optimal zone, swept across cinemas × dates, served from a cached DB with a live
re-verify on open. Design is locked (`design/seats-together-design.md`).

- **ST-1 (#26) DONE.** `packages/core/src/blocks.ts` — `findAdjacentBlocks(seats, {minScore, size})`
  + 7 tests (`blocks.test.ts`), exported from the core barrel. Core suite 16/16. Geometry-agnostic;
  keeps party-N / minScore tunable at query time.
- **ST-2..5 (#27–#30) TODO.** Next = **ST-2 (#27)**, the db + ingester. Checkpoint is AFTER ST-2.

## Branch / git state
- All ST-1 work is on branch **`feat/seats-together`** (pushed to origin, **unmerged**), based off
  `main`. Plan: keep ST-1+ST-2 on this branch, open the PR at the ST-2 checkpoint.
- `main` is live and clean: the live tool + UI rebuild + all of #1–#25 are shipped. App is live at
  **https://seatfinder.miloli.org** (NO auth — removed 2026-06-24; Fastify rate-limit still guards
  upstreams). NAS deploy at `/mnt/raptor/claude-projects/seatfinder`, web on port 9015.

## Resume steps
1. `cd F:\dev\auscinema-seatfinder && git checkout feat/seats-together` (pull latest).
2. Re-read `design/seats-together-design.md` (locked decisions + schema) and issue **#27**.
3. **Confirm with Milo the verify-DB approach (the one open question):** how to run ST-2's
   "manual run, verify rows" checkpoint. Recommended **option 1 — throwaway Postgres via the NAS
   docker test-runner** (`reference_nas_docker_test_runner`): a real sweep against the live chains
   writing to a disposable pg, proving schema + upsert end-to-end WITHOUT touching the live deploy.
   (Option 2 = stand up the real NAS Postgres early, bleeds ST-5 work into ST-2 — not preferred.)
   Milo had not confirmed this when we paused.
4. Build ST-2, then **STOP at the checkpoint** — show Milo the ingested rows before building the
   API (#28) / UI (#29) on top of the cache.

## ST-2 scope (what to build)
- **New `packages/ingester`** workspace: a worker that, per enabled watch, sweeps
  `adapter.listSessions` across cinemas × date-range, `adapter.getSeatMap` per session, scores via
  `scoreAvailableSeats` (core), and upserts `sessions` + `session_seats` (available-only) into pg.
  Mirror the watcher's per-session isolation + backoff (`packages/watcher/src/check.ts`,
  `cli.ts` — fixed in #21/#22). Concurrency-limited, polite, error-tolerant; write an `ingest_runs`
  row per sweep (powers a dead-man staleness alert).
- **Schema** (SQL migration) + **`watches.json`** seed. Tables/columns are spec'd in the design doc:
  `watches`, `sessions`, `session_seats(session_id, seat_id, row_label, row, col, area_kind, score)`,
  `ingest_runs`. Store AVAILABLE seats only (a missing column = a break). Per-session upsert in a
  transaction (delete+insert that session's seats).
- **pg client:** node-postgres (`pg`). `DATABASE_URL` from env.

## Locked decisions (don't relitigate)
- Own Postgres instance in the seatfinder stack (not shared with PriceWatch).
- Storage = sessions + scored available seats (not fixed blocks) → N/Q tunable at query time.
- Config-driven watchlist from `watches.json`; hourly per-watch refresh; single chain per watch.
- Hybrid freshness: DB for discovery, LIVE `/seatmap` re-verify on open. `/together` is additive;
  the live tool is untouched.
- Hoyts adjacency is approximate (index-order cols) — label it in results.

## Key paths
- Core fn: `packages/core/src/blocks.ts` (+ `.test.ts`). Scoring: `packages/core/src/scoring.ts`
  (`scoreAvailableSeats`). Adapters: `packages/adapters/{event,hoyts,reading,village}/src/index.ts`.
  Watcher (isolation/backoff reference): `packages/watcher/src/{check,cli}.ts`.
- Deploy: `deploy/docker-compose.yml` (+ `.env`, `Caddyfile`). Compose footguns:
  `.claude/memory/reference_compose_caddy_deploy_footguns` ($→$$ in .env; Caddy `handle` blocks).
- Design: `design/seats-together-design.md`. Local-only build log: `docs/session-log.md`.
