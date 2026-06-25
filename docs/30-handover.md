# #30 Tiered cache refresh — handover (fresh-session start here)

Status: NOT STARTED. Spec is written and Codex-reviewed; this is the orient doc to pick it up cold.
Everything before #30 (picker, P0 live-recompute, tz/UX fixes #43/#44/#45) is MERGED to `main`
(`2f040cd`) and live on the NAS. Repo is `main`-only.

## Why #30 (the problem it solves)
The Seats-Together cache is a **materialized bounded-staleness discovery index** refreshed by a
**one-shot/manual** ingester. So:
- The cache is **11–23 h stale** (last sweep ran ~11:04 AM; sessions sold/started since). Today's
  started/sold sessions correctly show "block gone" on drill-in — honest, but reads as broken.
- Only the **Event** chain has any watch/cache. Hoyts/Reading/Village → empty picker ("No movies
  cached").
The live drill-in recompute (P0, shipped) already gives truth at the booking moment; #30 makes the
**grid** trustworthy so it stops advertising stale cells. It can never make a cached block
guaranteed-bookable — that's why the live confirm stays mandatory.

## The spec + review (read these first)
- **`docs/30-tiered-refresh-spec.md`** — the full design: age-driven refresh-ahead with date-proximity
  TTL tiers (AU/Sydney), advisory lock, jitter, per-chain budget/backoff, fair selection (replaces
  the slice-first-N cap bias), tombstones/active-set + `/together` `last_seen` filter, `/together`
  freshness metadata, dead-man cache-age alert. Phased **P30.1 freshness MVP → P30.2 tombstones →
  P30.3 observability → P30.4 chain coverage (depends on #41)**. Deferred: per-session timers
  (rejected), demand hot-refresh lane, server-side on-click writeback, adaptive TTL.
- **`reviews/FRESHNESS-REVIEW.md`** — Codex architecture review (SOUND-WITH-CHANGES) that shaped it.

## 4 OPEN DECISIONS — get Milo's call before/at build start
1. TTL values (today/tmrw ~1 h · this-week ~6 h · 1–2 wk ~24 h) + scheduler tick (~15 min) — accept
   defaults or tune?
2. Tombstones (P30.2) now or deferred — needs a small schema migration; cache is otherwise correct
   for future dates, just keeps disappeared sessions.
3. Per-chain politeness budget (fetches/tick) — set conservative, raise from metrics?
4. Sequence: do P30.1–P30.3 first, then **#41** (Event multi-cinema fan-out), then P30.4 coverage?

## Current ingester shape (what you're extending)
- `packages/ingester/src/sweep.ts` → `runSweep(deps)`: loads enabled `watches` (by id), per watch lists
  sessions across `[date_from,date_to]`, **flat slice-first-N cap** `maxSeatmapsPerWatch` (60),
  fetch+score+`upsertSessionWithSeats` (per-session txn, refreshes `fetched_at`+`last_seen`), one
  `ingest_runs` row. `cli.ts` runs ONE sweep and exits — no scheduler.
- `last_seen` is written but **`/together` never filters on it** (the tombstone gap).
- `session_seats` keyed `(session_id, seat_id)`, no watch/scoring dimension (frozen v1). All NAS
  `watches.scoring` are NULL = default (keep it that way or the grid/drill-in scoring can diverge).

## Plumbing (so you don't re-derive it)
- Repo: `F:\dev\auscinema-seatfinder` (local; Codex runs in-repo, no SMB issue). Public:
  `miloli-git/auscinema-seatfinder`. Board: `miloli-git/projects/1`.
- **Tests:** api uses **`node --test`** not vitest → `cd packages/api && npm test`
  (= `tsc -b && node --test dist/*.test.js`; DB-backed tests skip without `DATABASE_URL`, spin a
  disposable `postgres:16-alpine -p 5433` and set `DATABASE_URL=...@192.168.1.222:5433/sftest` to run
  them). Web: `cd apps/web && npx vitest run` + `npm run typecheck` + `npx playwright test`.
- **Deploy:** NAS `claude-code@192.168.1.222`, `/mnt/raptor/claude-projects/seatfinder/`. Pull on NAS →
  `cd deploy && sudo docker compose up -d --build --force-recreate <svc>`. A new **`refresh`** worker
  service (P30.1) joins `api`/`web`/`db` in `deploy/docker-compose.yml`. DB: `psql -U seatfinder -d
  seatfinder` via `docker compose exec db`.
- **Method:** dual-harness (Codex authors frozen tests + adversarial review; Claude builds + fixes).
  `codex exec -s workspace-write --skip-git-repo-check -C F:\dev\auscinema-seatfinder - < prompt`.
  Findings land in `reviews/` (gitignored). Verify live with curl/psql on the NAS + Playwright on
  `seatfinder.miloli.org`.

## KEY GOTCHA (bit us in #43/#44 — carry it forward)
Two ISO-with-`Z` fields, OPPOSITE handling:
- `session.startTime` = **local Sydney wall-time mislabelled with a fake `Z`** (`...T14:00:00Z` = 2 PM
  Sydney). Compare by **substring**, never parse as UTC.
- `session.fetched_at` = a **true UTC instant**. **Convert** to Sydney (`formatInstantSydney`).
For #30, "is this session in the past / which TTL tier" must use the local wall-time path (see
`apps/web/src/format.ts` `isUpcoming`/`sydneyNow` for the established pattern), and tier boundaries
must be computed in **Australia/Sydney**.

## Verification bar
Unit + e2e green is not done — finish on a live gate: prove a scheduled sweep ran on the NAS (fresh
`ingest_runs` row, `fetched_at` advanced, no overlap with the lock held), and that `/together`
freshness metadata + the grid reflect it. Browser-smoke via Playwright.
