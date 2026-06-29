# #60 — Data horizon / far-future coverage (acceptance source of truth)

Tests AND implementation target THIS. Issue #60. Branch `feat/60-data-horizon`. Base `main`.

**Why:** The canonical v1 acceptance test ("find 2 good IMAX seats for The Odyssey + how far ahead",
ON THE PAGE) reads the Postgres cache, not the live CLI. Two coverage bugs in the already-shipped
tiered refresh (`packages/ingester/src/refresh.ts`) keep far-future titles out of the cache:

1. **Static horizon.** Watches carry absolute `[dateFrom, dateTo]` (seeded `2026-06-26..2026-07-26`).
   Discovery scans exactly that window and `inScope()` gates on `date <= dateTo`, so the horizon does
   NOT roll forward — titles opening past the static edge are never discovered. The fix must be durable
   (still correct weeks from now), not "Odyssey happens to sit inside today's static window".
2. **T2 first-ingest starvation.** `selectDueSessions` orders strictly `T0→T1→T2` and caps at
   `budgetPerChain`. Newly-discovered far-future sessions (T2) sit at the back every tick; a busy
   near-term cache can starve them so they never get their FIRST seat-map fetch → never enter the cache.

Decision (Milo): **rolling horizon = `today .. today + 35 days`** (Australia/Sydney calendar),
config-overridable; reserve a per-chain budget lane for never-fetched sessions so far-future first
ingest cannot be starved; surface the effective horizon on `/catalog` so the page can state coverage
honestly.

## Architecture (three parts)
1. **Pure core — `packages/ingester/src/horizon.ts` (NEW)** — rolling-window + horizon date math.
   Deterministic, no clock, no I/O. **Primary dual-harness target** (Codex authors `horizon.test.ts`).
2. **Pure selection — `selectDueSessions` in `refresh.ts` (EXTEND)** — add a reserved first-ingest lane.
   Still pure (operates on `KnownSession[]`). **Second dual-harness target** (extend `refresh.test.ts`'s
   pure C2 cases — these run with no DB).
3. **Wiring + surface (integration, live gate)** — `runLockedTick` discovery + `inScope` use the rolling
   window; `/catalog` returns `horizonDate`. Verified at the Postgres live gate (Part: Live acceptance),
   not by frozen units.

## Environment / runtime
- TS, `@auscinema/core` + ingester. Unit tests: `node --test` (`node:test` + `node:assert/strict`),
  importing from `./horizon.ts` / `./index.js`. Pure tests run with no `DATABASE_URL` (must stay green
  offline, like the existing C1/C2 cases). DB-integration cases gate on `DATABASE_URL` and load
  `db/schema.sql` (see `refresh.test.ts` `before()`), refusing to run against a DB named `seatfinder`.
- Reuse existing helpers — do NOT reimplement: `datesInRange(from,to)` (`watches.ts`, UTC-midnight,
  `MAX_RANGE_DAYS=366`), `sydneyDate(instant)` (Sydney calendar "YYYY-MM-DD", already in `refresh.ts`),
  `dayDiff` style UTC-midnight date math.

## API / behaviour

### Part 1 — `packages/ingester/src/horizon.ts` (export all; re-export from `index.ts`)

```ts
/** Add `days` to a "YYYY-MM-DD" calendar date, UTC-midnight math (no TZ drift). days may be 0. */
export function addCalendarDays(ymd: string, days: number): string;

/** Default rolling horizon depth in days. Env REFRESH_HORIZON_DAYS overrides (positive int). */
export const DEFAULT_HORIZON_DAYS: number; // = 35

/** Resolve the configured horizon depth from env, falling back to DEFAULT_HORIZON_DAYS. */
export function resolveHorizonDays(env?: Record<string, string | undefined>): number;

/**
 * The rolling discovery/scope window for a watch, given the Sydney "today" and horizon depth.
 *   from = max(today, watch.dateFrom)   — never scan the past; honour a watch that starts later
 *   to   = today + horizonDays          — rolling far edge (the watch's static dateTo is NOT a cap)
 * Returns null when the window is empty (from > to), e.g. a watch whose dateFrom is beyond the horizon.
 */
export function effectiveWindow(
  watch: { dateFrom: string; dateTo: string },
  today: string,
  horizonDays: number,
): { from: string; to: string } | null;

/** The far edge of coverage the cache is attempting = today + horizonDays. */
export function horizonDate(today: string, horizonDays: number): string;
```

### Part 2 — `selectDueSessions` reserved first-ingest lane (`refresh.ts`)
- `KnownSession` gains `neverFetched: boolean` (true for discovered-new sessions, which already use
  `fetchedAt = new Date(0)`; existing cached rows are `false`).
- New OPTIONAL option: `selectDueSessions(known, { budgetPerChain, reserveForNew?, nowInstant })`.
  `reserveForNew` is **optional and defaults to 0 when omitted** (so the existing C2 tests that call the
  old 2-field signature keep passing unchanged). The env default `REFRESH_RESERVE_NEW_PER_CHAIN`
  (default **10**) is resolved by the CALLER (`runLockedTick`) and passed in explicitly — the env is
  NEVER read inside the pure fn.
- Selection per chain, over the DUE set (`isDue` unchanged):
  1. **Reserved pass:** take up to `reserveForNew` `neverFetched` due sessions, ordered by the existing
     `orderDue` (tier then RR then stalest). These are guaranteed even if the chain's normal budget is
     fully consumed by T0/T1.
  2. **Main pass:** from the remaining due sessions (excluding those already selected), fill up to
     `budgetPerChain` using `orderDue`.
  3. Total selected per chain ≤ `reserveForNew + budgetPerChain`. Skipped (everything due but not
     selected by either pass) is reported in `skipped`, keyed `(chain,tier,cinemaId,date)` as today.
- `reserveForNew = 0` → identical behaviour to today (pure back-compat).

### Part 3 — wiring + surface (integration)
- `runLockedTick`: compute `today = sydneyDate(nowInstant)`, `H = resolveHorizonDays()`. For each watch,
  discovery iterates `datesInRange(eff.from, eff.to)` where `eff = effectiveWindow(watch, today, H)`
  (skip the watch when `eff === null`). `inScope()` gates on `date >= eff.from && date <= eff.to` for
  the session's matching watch (replacing the static `>= dateFrom && <= dateTo` check). Pass the
  resolved `reserveForNew` into `selectDueSessions`.
- `/catalog` (`packages/api/src/index.ts`): add `horizonDate: string` (= `horizonDate(sydneyToday, H)`)
  and `maxCachedDate: string | null` (furthest `date` among live cached sessions, null if none) to the
  response, alongside the existing distinct movies/cinemas/dates.

## Done-when (per behaviour, checkable)
- `addCalendarDays("2026-06-29", 35)` = `"2026-08-03"`; `addCalendarDays("2026-02-28", 1)` = `"2026-03-01"`
  (2026 non-leap); `addCalendarDays(d, 0)` = `d`. Negative days allowed and symmetric.
- `effectiveWindow({dateFrom:"2026-06-26",dateTo:"2026-07-26"}, "2026-06-29", 35)` =
  `{from:"2026-06-29", to:"2026-08-03"}` — `to` is `today+35`, NOT the static `2026-07-26`; `from` is
  clamped up to today (never the past).
- `effectiveWindow` with `watch.dateFrom = "2026-07-10"` (later than today) → `from = "2026-07-10"`.
- `effectiveWindow` returns `null` when `from > to` (watch starts beyond the horizon, e.g. dateFrom
  `2027-01-01`, today `2026-06-29`, H 35).
- `horizonDate("2026-06-29", 35)` = `"2026-08-03"`.
- `resolveHorizonDays({})` = 35; `{REFRESH_HORIZON_DAYS:"60"}` = 60; non-positive/garbage → 35.
- `selectDueSessions` with `reserveForNew:10`, a chain whose due set is `budgetPerChain` T0 sessions
  PLUS several `neverFetched` T2 sessions → at least the T2 never-fetched (up to 10) ARE selected even
  though T0 alone fills `budgetPerChain` (proves no starvation). Total ≤ reserve + budget.
- `selectDueSessions` with `reserveForNew:0` → byte-identical selection to the pre-change behaviour
  (the existing C2 tests still pass unchanged).
- A `neverFetched` session is only selected once (reserved pass dedupes against the main pass).
- `/catalog` returns `horizonDate` = Sydney-today + H and `maxCachedDate` = furthest live cached date.

## Non-negotiables
- `horizon.ts` is PURE: no `Date.now()`/argless `new Date()`, no network, no I/O. `today` injected.
- Reuse `datesInRange` / `sydneyDate` — do not fork date logic. Respect `MAX_RANGE_DAYS` (35 ≪ 366, fine).
- Rolling window is the SINGLE source of truth used by BOTH discovery AND `inScope` — they must not
  diverge (a session discovered but out-of-scope would be fetched-then-ignored, the exact bug to avoid).
- Do not change `session_seats` schema, the advisory-lock key, the ledger invariant
  (`sessions_due = refreshed + errors + skipped_budget`), or tombstone/backoff logic.
- Politeness: the rolling window only widens the date axis by design; per-chain budget + reserve keep
  per-tick fetch volume bounded. `reserveForNew` is a small constant, not "fetch everything new".

## Test requirements (for the test author — numbered; cover the nasty edges)
1. `addCalendarDays`: +35 across a month boundary; +1 across `2026-02-28` (non-leap) and `2024-02-28`
   (leap → `2024-02-29`); +0 identity; −1 across a month start; year boundary `2026-12-31`+1.
2. `effectiveWindow`: `to` = `today + H` regardless of (and beyond) the static `dateTo`.
3. `effectiveWindow`: `from` = `max(today, watch.dateFrom)` — past `dateFrom` clamps up to today; future
   `dateFrom` is honoured.
4. `effectiveWindow`: returns `null` when the resolved `from > to`.
5. `horizonDate` = `today + H`.
6. `resolveHorizonDays`: default 35; valid override; non-positive, non-numeric, empty → default.
7. `selectDueSessions` reserved lane: T0 due ≥ budget AND ≥1 `neverFetched` T2 due → the never-fetched
   T2 is selected (would be dropped without the reserve). Assert the specific far-future id is present.
8. `selectDueSessions` reserve cap: more `neverFetched` due than `reserveForNew` → exactly `reserveForNew`
   of them taken via the reserved pass (rest may still come via the main pass within `budgetPerChain`);
   total per chain ≤ `reserveForNew + budgetPerChain`; overflow reported in `skipped`.
9. `selectDueSessions` back-compat: `reserveForNew:0` reproduces the existing tier-priority/RR selection
   exactly (reuse an existing C2 scenario's expectation).
10. `selectDueSessions` dedup: a `neverFetched` session selected in the reserved pass is not double-counted
    in the main pass.
11. (DB-gated, optional but preferred) discovery with a rolling window: a stub adapter returns a
    far-future session (date = today+20, beyond a static `dateTo` of today+5) under a flood of near-term
    T0 sessions; after one `runRefreshTick` the far-future session row EXISTS and was seat-fetched
    (`sessions_new ≥ 1`, the far-future id is in `sessions`). Proves Parts 1+2+3 end-to-end.

## Live acceptance (the real gate — not unit)
Against a disposable Postgres (NAS), schema-loaded:
1. Seed a watch for Event cinemaId 96 (IMAX Sydney). Run `runRefreshTick` (real Event adapter OR a stub
   returning an Odyssey-shaped far-future session ~17–20 days out). Assert the far-future session is
   discovered AND seat-fetched in ONE tick despite near-term load (the starvation repro).
2. `GET /catalog` returns `horizonDate = Sydney-today + 35` and `maxCachedDate` reflecting the
   far-future session — i.e. the page can now honestly answer "covered up to <date>" for Odyssey.
Capture the tick ledger + `/catalog` JSON as acceptance evidence.

## Out of scope
- The `/together` / `#47` UI rendering of coverage (this issue only adds the data + `/catalog` field).
- Cross-chain title identity (#61). Per-watch configurable horizon depth (one global `H` for v1).
- Changing TTL tiers, backoff, tombstones, or the advisory lock. Demand-driven hot-refresh.
- Rewriting the static watch `dateFrom`/`dateTo` columns away (kept; `dateFrom` still honoured as a
  floor, `dateTo` simply no longer caps the horizon).
