# #30 arc — frozen contracts (build/review agents key off this)

Status: FROZEN for the autonomous arc. No agent may change a signature here without a receipt note
explaining why. Build agent implements to these; Codex review agent tests against these. Source specs:
`docs/30-tiered-refresh-spec.md`, `reviews/FRESHNESS-REVIEW.md`, `reviews/30-RALPH-PLAN-REVIEW.md`.

Decisions locked: Q1 defaults · Q2 tombstones-in-gated · Q3 ~30/tick/chain · Q4 sequence ·
Q5 orchestrator-deploys · Q6 leave watches split · Q7 full-arc-with-receipts · Q8 full loop/phase ·
Q9 NEW `refresh_runs` table.

---

## C0 — Tick runner (P30.1) — ratified from Codex P30.1 test notes
```
runRefreshTick(deps: {
  pool, registry, nowInstant: Date, budgetPerChain: number, concurrency?: number
}): Promise<RefreshRunRow>
```
- Mirrors `runSweep` DI style (`packages/ingester/src/sweep.ts:160`). `nowInstant` injectable.
- One tick = acquire advisory lock (C3) → discover-if-due → `selectDueSessions` (C2) → fetch under
  `budgetPerChain` (C5) → upsert → write one `refresh_runs` row (C4) → release.
- Returns the `refresh_runs` row it wrote (the frozen DB tests assert on it).
- `SkipCounts` (C2) representation is NOT frozen as a single object layout — tests assert dropped
  counts semantically by `(chain,tier,cinemaId,date)`. Build agent picks the structure; it MUST be
  queryable by those four keys and surface into `refresh_runs.per_chain`/`per_tier`.
- Discovery semantics (frozen): a newly listed session is fetched in the same tick and counted
  `sessions_new=1, sessions_due=1, sessions_refreshed=1`. (Tombstone/`disappeared_at` is P30.2 — not
  here.)

## C1 — Tiering (P30.1)
```
type RefreshTier = 'T0' | 'T1' | 'T2'
tierForSessionDate(sessionDate: string, nowInstant: Date): RefreshTier
```
- `sessionDate` is AU/Sydney **local** wall-time (the fake-`Z` `startTime` path) — compare by
  substring, NEVER UTC-parse. `nowInstant` is a true UTC instant, injectable for tests.
- Tier boundaries computed in Australia/Sydney: T0 = today+tomorrow, T1 = 2–7d, T2 = 8d+.
- TTL(tier) is config, not hard-coded: T0 1h · T1 6h · T2 24h, ±15% jitter. Defaults overridable by env.
- Reference pattern: `apps/web/src/format.ts` `isUpcoming`/`sydneyNow` (the established tz path).

## C2 — Due selection + fairness (P30.1, subsumes #42)
```
selectDueSessions(known: KnownSession[], opts: { budgetPerChain: number, nowInstant: Date })
  : { selected: SessionId[], skipped: SkipCounts }
KnownSession = { sessionId, chain, cinemaId, date, fetchedAt, tier, live: boolean }
SkipCounts   = per (chain, tier, cinemaId, date) dropped counts — NO silent caps
```
- Session is due iff `age(now - fetchedAt) >= ttl(tier)` (after jitter).
- When due-set > `budgetPerChain`: order by **tier priority → oldest `fetchedAt` → round-robin across
  real `(cinemaId, date)` buckets**. The old per-watch `maxSeatmapsPerWatch` flat slice is NOT used.
- Must stay fair after #41 collapses cinemas into one watch (partition on `cinemaId`, not watch).

## C3 — Advisory lock (P30.1)
- Deterministic `pg_try_advisory_lock` key (constant, documented). `try` semantics.
- Second concurrent tick acquires nothing → records a `lock_skipped` run row, performs ZERO upstream
  fetches, returns. Two ticks / two containers never sweep concurrently.

## C4 — `refresh_runs` ledger (P30.1, NEW table — Q9)
Additive `CREATE TABLE` migration. Does NOT touch existing `ingest_runs`. One row per tick.
```
refresh_runs(
  id, started_at, finished_at,
  outcome,                 -- 'ok' | 'lock_skipped' | 'error'
  sessions_due, sessions_refreshed, sessions_skipped_budget,
  sessions_new, sessions_disappeared, errors,
  per_chain jsonb,         -- { chain: { due, refreshed, skipped, errors, backoff } }
  per_tier  jsonb          -- { T0|T1|T2: { count, oldest_age_s, newest_age_s } }
)
```
- Every counter always meaningful (non-null) — no source filtering needed downstream.
- Dead-man alert (P30.3) and metrics read THIS table only.

## C5 — Per-chain budget + backoff (P30.1)
- `budgetPerChain` default 30 seatmap fetches/tick, env-overridable. Bounded concurrency reused.
- Majority-error tick for a chain → back that chain off; other chains isolated (one chain's backoff
  never starves the rest). Recorded in `per_chain.backoff`.

## C6 — Tombstones / liveness (P30.2) — ratified from Codex P30.2 test notes
- Additive migration: `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS disappeared_at timestamptz NULL`
  + re-runnable index on `disappeared_at`. Existing rows = NULL. Old code tolerates NULL.
- Discovery marks in-scope-but-absent sessions: set `disappeared_at = nowInstant` (injected, NOT literal
  `now()`, for deterministic tests). A session is tombstoned ONLY when its scope's `listSessions`
  returned a **NON-EMPTY** result that excludes it. "Listed scope this tick" = a SUCCESSFUL `listSessions`
  for an enabled watch/date; sessions outside that chain/cinema/date/movie scope are NOT tombstoned.
  An **EMPTY** listing is treated as INCONCLUSIVE — it tombstones nothing (a failed or empty discovery
  must not mass-tombstone; an empty upstream result is far likelier an endpoint hiccup than every session
  at a cinema/date vanishing at once). Cross-phase invariant: this keeps the P30.1 frozen tests valid,
  where `stubAdapter(chain, [], maps)` returns an empty listing yet the cached sessions stay live/due.
  `refresh_runs.sessions_disappeared` increments only on real tombstones.
- Resurrection: a tombstoned session returned again by discovery resets `disappeared_at = NULL`, live/due again.
- Ledger invariant unchanged: disappeared sessions are not due/refreshed; `sessions_due =
  sessions_refreshed + errors + sessions_skipped_budget` still holds on a tombstoning tick.
- `/together` predicate: exclude `disappeared_at IS NOT NULL` AND past-date sessions (Sydney local
  fake-Z wall-date by `YYYY-MM-DD`/`date` column, NEVER UTC-parse `start_time`). No new route signature.
  "stale/unknown" surfaced distinctly from "sold out".
- Purge: `purgeDisappearedSessions({ pool, nowInstant, retentionMs }): Promise<void>` removes ONLY
  tombstoned sessions where `disappeared_at < nowInstant - retentionMs` (+ their `session_seats` via FK
  cascade or explicit delete); recent tombstones retained. (Past-but-live-date purge is out of P30.2
  scope — `/together` already hides them.)
- Migration applied on NAS BEFORE the API code that references `disappeared_at` deploys.

## C7 — `/together` freshness metadata (P30.3)
Top-level **additive** keys (existing `party`/`minScore`/`count`/`results` unchanged):
```
freshness: {
  oldestFetchedAt, newestFetchedAt, lastSuccessfulIngestAt,
  coverage: { [chain]: 'cached' | 'not_cached' | 'stale' }
}
```
- Empty-result behavior defined: empty `results` + `coverage[chain]='not_cached'` means "not ingested
  yet", distinct from cached-but-no-sessions and sold-out. UI words availability as "moments ago".

## C8 — Event #41 adapter fan-out
```
listSessions({ cinemaIds: string[] }) -> Session[]   // union, dedupe by session id
```
- One request PER cinemaId, merged; NEVER a single comma `cinemaIds=15,96` request (returns 0 today,
  `packages/adapters/event/src/index.ts:54-57`). Test: 2 cinemaIds → union, no comma path.
- Watch topology stays split this pass (Q6). Collapse deferred to P30.4 — `seedWatches` only inserts
  new natural keys (`seed.ts:65-86`), so collapse needs explicit orphan-disable, out of scope here.

---

## Phase receipts (Q7 — orchestrator gates on these; resume from last green, never replay arc)
Each phase leaves: commit SHA · frozen tests added · local tests green · Codex review verdict ·
live/NAS evidence where the phase deploys. Receipts appended to `reviews/30-RECEIPTS.md`.

- **P30.1** freshness MVP → DEPLOY + live NAS gate (fresh `refresh_runs` row, lock held, no overlap)
  BEFORE P30.2 starts.
- **P30.2** tombstones → additive migration applied on NAS before API code deploys; fix-forward on fail.
- **P30.3** freshness metadata + dead-man alert → freeze C7 JSON before API/web work.
- **#41** fan-out → if fails, keep split-watch workaround; does not block prior phases.
