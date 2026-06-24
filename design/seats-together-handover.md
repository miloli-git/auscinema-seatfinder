# Seats Together — handover (resume in a new session)

Last updated 2026-06-24. Read this with `design/seats-together-design.md`, `docs/session-log.md`,
`docs/codex-review-loop.md`, and epic #31 to resume.

## Where we are
Building the **Seats Together** feature (epic **#31**): for a movie, find sessions with N adjacent
seats in the optimal zone, swept across cinemas × dates, served from a cached DB with a live
re-verify on open. Design is locked (`design/seats-together-design.md`).

- **ST-1 (#26) DONE.** `packages/core/src/blocks.ts` - `findAdjacentBlocks(seats, {minScore, size})`
  + 7 tests (`blocks.test.ts`), exported from the core barrel. Core suite 16/16. Geometry-agnostic;
  keeps party-N / minScore tunable at query time.
- **ST-2 DB standup DONE.** Commit `c104eda` added `db/schema.sql`, Postgres compose service,
  `deploy/.env.example`, and live NAS DB verification. The ingester half of #27 is next.
- **ST-2 ingester TODO.** Build `packages/ingester`, run one manual sweep, verify rows, then stop
  for Milo + Codex review before API/UI work.
- **ST-3..5 (#28 to #30) TODO.**

## Branch / git state
- All ST-1 work is on branch **`feat/seats-together`** (pushed to origin, **unmerged**), based off
  `main`. Plan: keep ST-1+ST-2 on this branch, open the PR at the ST-2 checkpoint.
- `main` is live and clean: the live tool + UI rebuild + all of #1–#25 are shipped. App is live at
  **https://seatfinder.miloli.org** (NO auth — removed 2026-06-24; Fastify rate-limit still guards
  upstreams). NAS deploy at `/mnt/raptor/claude-projects/seatfinder`, web on port 9015.

## Resume steps
1. `cd F:\dev\auscinema-seatfinder && git checkout feat/seats-together` (pull latest).
2. Re-read `design/seats-together-design.md` (locked decisions + schema), `docs/session-log.md`,
   `docs/codex-review-loop.md`, and issue **#27**.
3. Do not revisit the verify-DB option. Milo chose the real NAS Postgres path and DB standup is done.
4. Build the ingester half of ST-2, then **STOP at the checkpoint**: show Milo the ingested rows and
   write `reviews/checkpoints/ST-2-ingester.md` for Codex before building API (#28) or UI (#29).

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

## Codex review harness

Claude Code is the builder. Codex is the checkpoint reviewer. Codex cannot see Claude Code's
in-memory session state, so Claude must write a durable checkpoint packet before requesting review.

For the ST-2 ingester checkpoint:
- Fill `reviews/checkpoints/ST-2-ingester.md`.
- Include branch/base, changed files, commands, test output, manual DB evidence, known gaps, and
  requested review focus.
- Ask Codex to review the packet, current diff, and relevant files.
- If Claude fixes any non-trivial finding, run a second Codex review on the amended code.
- Promote only high-signal findings to GitHub issues. Raw review files stay local in `reviews/`.

Primary Codex focus: transactionality, idempotence, failure isolation, available-only seat semantics,
session ID namespace, polite upstream access, and proof that real adapter data reached Postgres.

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
