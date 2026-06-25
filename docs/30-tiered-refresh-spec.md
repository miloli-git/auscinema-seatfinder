# #30 — Scheduled tiered cache refresh (spec)

Status: SPEC (pre-build). Source for a later dual-harness build. Companion review:
`reviews/FRESHNESS-REVIEW.md` (Codex, SOUND-WITH-CHANGES). Backlog issue #30.

## Goal

Keep the Seats-Together cache fresh on a schedule so the matrix grid is trustworthy, without
hammering the cinemas' public endpoints. Today the ingester is one-shot/manual — the live cache is
~9.5h stale, and only the Event watch is populated. This makes the drill-in "block gone" fire often
(the exact cached seats genuinely sold since the last sweep).

**Framing (per review):** this cache is a *materialized bounded-staleness discovery index*, not a
read-through cache. Refresh cadence lowers *how often* block-gone fires; it can never make a cached
block guaranteed-bookable — that's why the live drill-in confirm (and the P0 recompute-from-live
work) is mandatory and separate. #30 is the freshness baseline, not a correctness guarantee.

## Current state (grounded)

- `runSweep(deps)` (`packages/ingester/src/sweep.ts`): loads enabled `watches` (ordered by id),
  per watch lists sessions across `[date_from, date_to]`, caps candidates at `maxSeatmapsPerWatch`
  (default 60, **flat slice-first-N**), fetches+scores each seat map, `upsertSessionWithSeats`
  (per-session txn → refreshes `fetched_at` + `last_seen`). One `ingest_runs` row per sweep.
- No scheduler — `cli.ts` runs one sweep and exits.
- `last_seen` is written but **`/together` never filters on it** → disappeared/cancelled sessions
  linger until date filters age them out.
- `session_seats` is keyed `(session_id, seat_id)` with no watch/scoring dimension (frozen v1).

## Design

### 1. Age-driven refresh-ahead with date-proximity tiers (replaces flat-hourly)
Don't run separate per-tier cron jobs. One scheduler selects *due* sessions by comparing
`now - fetched_at` against a TTL that depends on the session's **date proximity to today**
(seats churn fastest near showtime). A session is due when `age >= ttl(tier)`.

| Tier | Date window (AU/Sydney local) | TTL (refresh-ahead) |
|------|-------------------------------|---------------------|
| T0   | today + tomorrow              | ~1h  |
| T1   | 2–7 days out                  | ~6h  |
| T2   | 8+ days out                   | ~24h |

- "Today" computed in **Australia/Sydney** (showtimes are AU-local; UTC would tier wrong near
  midnight). TTL values are config, not hard-coded — start with the above, tune from metrics.
- Add **jitter** (±10–20%) to each TTL so same-tier sessions don't herd onto the same wall-clock.

### 2. Two operations per tick
- **Discovery** (per watch, moderate cadence ~hourly): re-`listSessions` to find *new* sessions
  (insert as due) and *disappeared* ones (present in scope last sweep, absent now → tombstone, §4).
- **Seat refresh** (per known session, age/TTL-driven): fetch+score+upsert seats when due.

### 3. Scheduler runtime
- Run as a **compose service** in the existing stack (`refresh` worker alongside `api`/`web`/`db`),
  restart policy `unless-stopped`. Self-contained; no external cron. (Matches the primer's
  "hourly compose loop" intent but age-driven, not fixed-interval.)
- Tick every ~15 min; each tick = acquire lock → discover-if-due → select due sessions under budget
  → refresh → record metrics → release.

### 4. Anti-stampede, budget, fairness (the operational furniture the review flagged)
- **Overlap lock:** wrap each tick in a Postgres advisory lock (`pg_try_advisory_lock`). If held,
  skip this tick (singleflight) — two ticks or two containers can never sweep concurrently.
- **Per-chain request budget + backoff:** cap seat-map fetches per tick per chain; reuse the
  existing bounded-concurrency map and `shouldBackoff` classifier. Back off a chain on a
  majority-error tick.
- **Fair selection (fixes the slice-first-N bias):** when the due set exceeds budget, pick by
  **tier priority then oldest `fetched_at`**, round-robin across (cinema, date) so no single
  cinema/date starves the rest. Record dropped-count per chain/tier (no silent caps).

### 5. Tombstones / active-set reconciliation
- Add a session liveness marker (e.g. `disappeared_at timestamptz NULL`, or reuse `last_seen` with
  a staleness guard). Discovery marks sessions in-scope-but-not-returned as gone.
- **`/together` filters out** tombstoned sessions and past-date sessions; a periodic purge drops
  rows older than a retention window. Surface "stale/unknown" distinctly from "sold out".
- Requires a small schema migration (re-appliable SQL, matches the existing init pattern).

### 6. Freshness metadata (so the UI can tell the truth)
- `/together` returns grid-level freshness alongside results: `oldestFetchedAt`, `newestFetchedAt`,
  `lastSuccessfulIngestAt`, and per-chain coverage state. (Per-result `fetchedAt` already exists but
  surfaces too late — only in the drill-in row.)
- UI shows data age on the grid and words availability as "available moments ago," not "available."

### 7. Metrics + dead-man alert
- Extend `ingest_runs` (or add `refresh_runs`): sessions due / refreshed / skipped-by-budget / new /
  disappeared, plus per-tier cache-age. Track the churn signals the review wants: exact block still
  available, exact gone but alternate found, no live block, cache age at click (the last two come
  from the drill-in path).
- **Alert on cache age** exceeding a threshold (dead-man), not just worker exit — reuse the project's
  Discord error webhook ([[.claude/memory/reference_error_alert_webhook]] pattern).

## Non-goals (explicitly deferred)
- **Per-session scheduled timers** — rejected (redundant with the live confirm, more load).
- **Demand-driven hot-refresh lane** — later: refresh on drill-in click, coalesced by `sessionId`
  with a cooldown so N users clicking one stale cell cause 1 refresh. Better than per-session timers.
- **On-click writeback** — later, and only as *server-side read-repair* with a monotonic-freshness
  compare-and-set (`observed_at` ≥ existing) + `sessionId` coalescing; never a casual client side
  effect (avoids a slow old fetch clobbering a fresh one).
- **Adaptive TTL by measured churn** — later, once §7 metrics exist to drive it (don't guess).
- **Scoring-profile-in-cache-key** — only if custom per-user scoring becomes user-facing. v1 pins one
  default profile; the ingester's watch scoring and the drill-in's `DEFAULT_SCORING` must match
  (latent divergence flagged in the review — document/enforce the single profile for now).

## Phasing
- **P30.1 — freshness MVP:** age-driven refresh-ahead + date tiers (AU tz) + advisory lock + jitter +
  per-chain budget/backoff + fair selection, as a compose `refresh` service. Deploy. Fixes the 9.5h
  staleness alone.
- **P30.2 — correctness:** tombstones / active-set + past-purge + `/together` `last_seen` filter
  (schema migration).
- **P30.3 — observability:** `/together` freshness metadata + churn metrics + cache-age dead-man alert.
- **P30.4 — coverage:** enable watches for Hoyts/Reading/Village (coordinate with **#41** Event
  multi-cinema fan-out) + empty-chain "not cached yet" UI semantics (distinct from no-sessions/sold).

## Open decisions (need Milo's call before build)
1. TTL values (1h / 6h / 24h) + tick interval (15m) — accept defaults or tune?
2. Tombstones (P30.2) now or deferred — it needs a schema migration; the cache is otherwise correct
   for future dates, just keeps disappeared sessions.
3. Per-chain politeness budget numbers (fetches/tick) — set conservative and raise from metrics?
4. P30.4 coverage depends on #41 — sequence #30 P30.1–P30.3 first, then #41, then P30.4?

## Test requirements (for the eventual dual-harness build, P30.1)
1. tier(date) maps correctly across AU/Sydney midnight + DST boundary (no off-by-one).
2. due-selection: a session is selected iff `age >= ttl(tier)`; jitter keeps it within ±band.
3. advisory lock: a second concurrent tick acquires nothing and no-ops (no double sweep).
4. budget: due > budget → exactly budget fetched, dropped-count recorded, selection is fair across
   (cinema, date) and tier-prioritised (no cinema/date starved).
5. backoff: a majority-error chain tick backs that chain off and isolates other chains.
6. discovery: new session inserted as due; an in-scope-but-absent session tombstoned (P30.2).
7. idempotence: a tick with nothing due performs zero upstream fetches and writes a clean run row.
