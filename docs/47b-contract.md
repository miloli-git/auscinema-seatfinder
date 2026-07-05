# #47b — `GET /availability` contract (date-availability module)

Locked spec: `docs/v1-close-plan.md` Slice 4. Scope decision: `gh issue view 47` comment
"Build-plan revision (2026-07-02)" — Together-only, single `party`, no live scan, ever. Plugs into
the 47a surface: `docs/47a-contract.md` (`/options`, `/catalog`, `apps/web/src/movies/*`). Serves the
canonical Odyssey acceptance gate, `gh issue view 54`: "find me 2 good seats at IMAX for The Odyssey,
and how far ahead do I need to look?" answered ON THE PAGE from cache only.

**Deploy note (pre-flag this now, don't discover it at deploy time — see 47a's own `/options` 404
that shipped in commit `2de95ab`):** `deploy/Caddyfile`'s `@api path` matcher
(`deploy/Caddyfile:26`) currently lists `/healthz /cinemas /sessions /seatmap /best /movies /together
/catalog /options` — it does **not** include `/availability`. Add `/availability` to that matcher in
the same PR that ships the route, or every request 404s at the edge in prod while working on
localhost.

## 1. `GET /availability`

Cache-only, `requirePool()` pattern, same global per-IP rate limiter as every other route
(`RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS`, default 120 req/min).

### 1.1 Query params

| param | type | required | default | notes |
|---|---|---|---|---|
| `movieKey` | string | yes | — | `"<chain>:<movieId>"`, identical parsing to `/options` (`parseMovieKey`, `packages/api/src/index.ts:335`). 400 on missing/malformed/unknown-chain, identical error text convention. |
| `party` | int | no | `2` | `Math.max(1, parsed ?? 2)`, mirrors `/together`/`/options`. Single scalar — see §5 (per-day party). |
| `minScore` | int | no | `74` | mirrors `/options`'s default. |
| `cinemaId` | string | no | — | narrows to one cinema within the movie's chain. |
| `chain` | string | no | derived from `movieKey` | same rule as `/options` §1.1: NOT an independent selector, only a same-chain sanity check. 400 if present and mismatched. |

`cinemaId` and `chain` are mutually exclusive per the locked spec's `[&cinemaId|chain]` — but since
`chain` here is a redundant sanity-check param (not an alternate selector; `movieKey` already fixes
the chain, exactly as in `/options`), the "or" in the spec is really "an optional `cinemaId` filter
within the movieKey's fixed chain." If both `cinemaId` and `chain` are supplied, both are validated
independently (chain-mismatch 400, cinemaId as a plain filter) — no special interaction.

No `dateFrom`/`dateTo`: the module always reports across the full cached horizon for this
`(movieKey[, cinemaId])`, from Sydney-today to `maxCachedDate`/`horizonDate` (§3). The client doesn't
get to ask for a sub-window — the date strip is a fixed, compact summary, not a calendar picker.

### 1.2 Response shape

```ts
interface AvailabilityResponse {
  movieKey: string;
  cinemaId: string | null;       // echoes the request; null when unscoped
  party: number;
  minScore: number;
  horizonDate: string;           // same as /catalog: today + REFRESH_HORIZON_DAYS
  maxCachedDate: string | null;  // same as /catalog: furthest live (non-tombstoned, future) cached date
  earliest: AvailabilityDate | null;   // first entry in `dates` with state === "good-block"; null if none
  earliestLeadDays: number | null;     // leadDays of `earliest`; null if earliest is null
  dates: AvailabilityDate[];     // ascending by date, one row per cached date in [today, maxCachedDate]
}

interface AvailabilityDate {
  date: string;               // YYYY-MM-DD
  state: "good-block" | "no-qualifying-block" | "sold-held-now" | "stale" | "not-cached";
  leadDays: number;            // whole days from Sydney-today to `date`, >= 0 (buildLeadTimeReport's leadDays)
  bestBlockScore: number | null;   // avgScore of the best `party`-size block THIS DATE, across all its
                                    // sessions/cinemas; null unless state === "good-block"
  soldHeldPct: number | null;      // see §4 — schema-dependent; null when not derivable (see §4.3)
  asOf: string | null;              // ISO UTC — freshest fetched_at among this date's sessions; null for not-cached
}
```

`dates` always spans the full `[today, maxCachedDate ?? horizonDate]` range (one row per calendar
day), NOT just days with sessions — a day with zero cached sessions is a `not-cached` row (§3), so
the strip reads as a continuous timeline rather than a sparse list with silent gaps.

### 1.3 Errors

Identical shape/precedent to `/options` §1.7 (`app.setErrorHandler`, `{ error: string }`):

- `400` — missing/malformed `movieKey`; `chain` param present and mismatched with `movieKey`.
- `503` — `database not configured`.
- `429` — rate limit exceeded.
- No adapter/upstream errors possible (cache-only, no `UpstreamError` path — same as `/options`/`/together`).

## 2. Engine: porting `buildLeadTimeReport` to a DB read

`packages/core/src/leadtime.ts` stays untouched and pure — it's a `SessionAvailability[] → LeadTimeReport`
aggregator with no I/O, and this module still routes through it. What changes is entirely upstream, in
how `SessionAvailability[]` gets assembled:

| | `scripts/lead-time.ts` (live CLI, #49) | `/availability` (this contract) |
|---|---|---|
| Session source | `adapter.listSessions()` per date in a scanned range | `SELECT ... FROM sessions WHERE movie_id=... [AND cinema_id=...] AND disappeared_at IS NULL AND date >= today` — same liveness filter as `/together`/`/options` |
| Seat map source | `adapter.getSeatMap(session.id)` live per session | `SELECT seat_id, row, col, score FROM session_seats WHERE session_id = ANY($ids)`, same table `/together` already reads |
| Adjacency | `findAdjacentBlocks(blockSeats, { minScore, size: party })` | **identical call**, same `packages/core/src/blocks.ts`, no change |
| `totalSeats`/`availableSeats` | computed from the live seat map's raw statuses (`isSeatable`) | see §4 — `sessions.seats_available` (existing) + `sessions.total_seats` (new column, §4.2) |
| `today` | system clock, read once in the CLI | `sydneyDate(new Date())`, same helper `/together`/`/options` already use — core still never reads a clock |
| Party | single scalar | single scalar (identical — no change) |
| Fit tier | N/A (CLI predates fit tiers) | **Together-only** — this module answers "earliest date with ONE adjacent block of N," full stop. It does NOT compute Nearby/Split. That ranking lives only in `/options`'s §1.5 fit-tier algorithm (locked by the 2026-07-02 build-plan revision, decision 2: "Known honesty gap accepted for v1: no 'earliest date at least Nearby' answer.") |

**Per-session → per-DATE aggregation (new — `buildLeadTimeReport` operates per-session, this module
needs per-day):**

1. Load all live sessions for `(movieKey[, cinemaId])` (one SQL query, mirrors `/together`'s
   `buildSessionFilter` + liveness `WHERE`).
2. Batch-load `session_seats` for all their ids (one SQL query, mirrors `/together`'s block-building
   step at `packages/api/src/index.ts:714` onward).
3. Build one `SessionAvailability` per session exactly as `/together` does today (same
   `findAdjacentBlocks(seats, { minScore, size: party })` call — reuse, don't reimplement).
4. Call `buildLeadTimeReport(availabilities, { party, minScore, today })` **once** — this gives a
   session-level `timeline` (already sorted ascending by date/startTime) plus `earliest`/`earliestLeadDays`
   over sessions, which is 90% of the aggregation this module needs.
5. Group `report.timeline` by `date` (already the right sort order — no re-sort needed) to produce
   the per-date `AvailabilityDate[]` rows the contract requires:
   - `bestBlockScore` for a date = max `bestPairScore` across that date's session-timeline entries
     (nulls excluded; null if every session that date lacks a qualifying pair).
   - `leadDays` for a date = `leadDays(today, date)` — same core helper `leadtime.ts` already exports
     internally; expose it (it's currently module-private in `leadtime.ts` — either export it or
     recompute the one-line UTC-midnight diff here; recomputing is fine since it's 3 lines and keeps
     `leadtime.ts` untouched, which this contract treats as a hard constraint (§0 below)).
   - `soldHeldPct` for a date = see §4.
   - `asOf` for a date = max `fetched_at` across that date's sessions (freshest wins, same "trust the
     newest" convention `/options`'s per-card freshness uses).
   - `state` for a date = §3's exhaustive mapping.
6. Dates in `[today, horizonDate]` with **zero** cached sessions get a synthetic row: `state:
   "not-cached"`, `leadDays` computed, `bestBlockScore: null`, `soldHeldPct: null`, `asOf: null` — see §3
   for the beyond-horizon vs not-yet-ingested split.

**§0 constraint:** `packages/core/src/leadtime.ts` is NOT modified by this slice. It is imported and
called exactly as `scripts/lead-time.ts` already does. All DB-read plumbing (steps 1-3, 5-6 above)
lives in `packages/api/src/index.ts` (new route handler) or a small new API-local helper module,
never inside `packages/core`. This mirrors the existing boundary: core stays pure/I-O-free, the API
package owns Postgres.

## 3. State semantics (exhaustive)

| State | Condition | Notes |
|---|---|---|
| `good-block` | At least one session that date has `findAdjacentBlocks(seats, {minScore, size: party}).length > 0` | `bestBlockScore` = best `avgScore` across that date's qualifying sessions |
| `no-qualifying-block` | ≥1 session cached that date, but none has a `party`-size block ≥ `minScore` | Distinct from `sold-held-now`: this state doesn't require the date to be highly sold — it may have plenty of available seats that just aren't in one contiguous in-zone run of size `party` (e.g. all singles/pairs, no run of 3 for a party of 3) |
| `sold-held-now` | ≥1 session cached that date, no qualifying block, AND aggregate `soldHeldPct` (§4) for the date is at or above a "highly sold" threshold | Threshold: reuse `TOGETHER_FRESHNESS_STALE_MS`'s sibling-constant pattern — new `AVAILABILITY_SOLD_HELD_THRESHOLD_PCT` env, default **90** (a date where 90%+ of sellable capacity is gone reads as "sold/held now" rather than the more generic "no qualifying block," per the copy discipline in §5). Below the threshold with no qualifying block → falls through to `no-qualifying-block`, not this state. |
| `stale` | The date's freshest session `fetched_at` is older than `freshnessStaleMs()` (same 2h-default helper `/together`/`/options` use) | Takes priority over `good-block`/`no-qualifying-block`/`sold-held-now` in the state-selection order below — a stale row shouldn't claim `good-block` confidently even if the last-known data had one |
| `not-cached` | Zero sessions cached for this date | Split into two sub-cases by copy, NOT by a 6th state (the locked spec is explicit: states are exhaustive at 5) — see §3.1 |

**State-selection order per date** (first match wins): `not-cached` → `stale` → `sold-held-now` →
`good-block` → `no-qualifying-block`. (`stale` is checked before the block/sold-held checks so a date
whose only session data is hours old is never reported as a confident `good-block`.)

### 3.1 `not-cached`: beyond-horizon vs not-yet-ingested

The locked spec requires distinguishing these via `/catalog`'s `horizonDate`/`maxCachedDate` — this
response embeds both fields directly (§1.2) so the client never has to make a second `/catalog` call
just to disambiguate a date strip cell:

- **Beyond horizon**: `date > horizonDate`. Copy: *"beyond current cache horizon"* / a muted
  "not yet tracked" cell — the ingester's watch config doesn't reach this far forward at all.
- **Not yet ingested**: `date <= horizonDate` (in policy range) but `date > maxCachedDate` (or
  `maxCachedDate` is null). Copy: *"not yet checked"* — the ingester should reach this date on a
  future sweep; it's a timing gap, not a horizon gap.
- **Within cache but zero sessions actually exist** (`date <= maxCachedDate` and still zero rows):
  this is legitimately "no sessions that day" (the cinema doesn't screen the film that date) — copy
  should say *"no sessions"*, not "not cached," since the cache genuinely reached this date and found
  nothing. This is a THIRD sub-case of the same `not-cached` state (state stays `not-cached` for API
  contract purposes — the distinction is copy-only, computed client-side from `horizonDate`/
  `maxCachedDate` which are already in the payload, exactly as the locked spec says: "distinguish in
  copy via `/catalog` horizonDate/maxCachedDate").

## 4. `soldHeldPct` — the schema question, resolved honestly

### 4.1 The problem

`db/schema.sql`'s own header comment is explicit: *"`session_seats` stores AVAILABLE + scored seats
ONLY... sold/aisle/spacer seats are intentionally not stored."* `leadtime.ts`'s `soldPct` needs
`totalSeats` (sellable capacity: available + sold + unavailable, per the #49 lesson embedded in
`scripts/lead-time.ts`'s `isSeatable()`) and `availableSeats`. The cache today gives us:

- `availableSeats` — derivable two ways, both already correct: `sessions.seats_available` (populated
  from `session.seatsAvailable` at ingest, `packages/ingester/src/sweep.ts:66`) OR `COUNT(*) FROM
  session_seats WHERE session_id = ?` (same number, since `session_seats` is exactly the
  available-seat set). Use `seats_available` — it's already a single indexed column read, no join.
- `totalSeats` (sellable capacity) — **not persisted anywhere.** The ingester fetches the full seat
  map (`adapter.getSeatMap`, `packages/ingester/src/sweep.ts:145`) which DOES contain every seat
  (available/sold/unavailable/spacer), but `toSeatUpserts` (`sweep.ts:36`) immediately filters to
  `scoreAvailableSeats` output (available-only) before anything is written. The total count is
  computed in memory during ingestion and then thrown away.

So: **`soldHeldPct` cannot be derived from what the cache currently stores.** Per the task framing,
resolving this honestly means picking one of "spec a minimal additive schema change" or "drop the
field with an explicit note" — the schema change is small, mirrors an existing precedent
(`sessions.seats_available` already stores a single derived scalar from the same ingest pass), and
the field is explicitly named in the locked spec's response shape, so this contract specs the
addition rather than dropping the field.

### 4.2 Schema addition (additive, idempotent, mirrors the repo's own convention)

```sql
-- #47b soldHeldPct (date-availability module). Sellable capacity = available + sold + unavailable,
-- computed from the FULL seat map at ingest time (before toSeatUpserts filters to available-only) —
-- the same isSeatable() rule scripts/lead-time.ts already uses for the #49 lesson (Event maps
-- sold/held seats to `unavailable`; counting only available+sold undercounts a barely-released
-- house). NULL for any row ingested before this column existed; the API treats NULL as "not
-- derivable" (§4.3), never as 0.
ALTER TABLE IF EXISTS sessions ADD COLUMN IF NOT EXISTS total_seats INTEGER NULL;
```

One column, nullable, `IF NOT EXISTS` — re-appliable per `db/schema.sql`'s stated convention (every
object in the file already uses this pattern; the `disappeared_at` and `/options` cinemaName-fallback
index additions later in the same file are the direct precedent for "additive column/index landed
after initial schema, guarded so re-running `schema.sql` is always safe").

**Ingester write path** (`packages/ingester/src/sweep.ts`):

- `toSeatUpserts` only sees the already-scored, already-available-filtered seats
  (`scoreAvailableSeats(map, pref)`) — it does NOT have access to the raw `map.seats` (all statuses).
  The total count must be computed at the call site in `sweepWatch` (`sweep.ts:143-149`), where `map`
  (the full `SeatMap`) is still in scope, using the same `isSeatable` predicate `scripts/lead-time.ts`
  already defines (`status === "available" || status === "sold" || status === "unavailable"` —
  duplicate this 1-line predicate into `packages/ingester/src/sweep.ts`, same "small isolated
  duplication over a cross-package import for a 1-liner" precedent the API package already uses for
  `MAX_HORIZON_DAYS`, per `packages/api/src/index.ts:282-286`'s own comment).
- `sessionToUpsert` (`sweep.ts:48`) gains one more field, `totalSeats`, sourced from the seat-map scan
  done in `sweepWatch` (passed in alongside the existing `session`/`watchId` params — `sessionToUpsert`
  itself stays a pure mapper, the count is computed just before calling it).
- `persist.ts`'s `upsertSessionWithSeats` INSERT/ON CONFLICT column list (`persist.ts:31,45`) gains
  `total_seats` alongside the existing `seats_available` column, same nullable-parameter pattern
  (`session.seatsAvailable ?? null` → `session.totalSeats ?? null`).
- The refresh-tier path (`packages/ingester/src/refresh.ts`) also fetches full seat maps on refresh
  ticks and must set `total_seats` the same way, or refreshed rows would silently regress the column
  to stale/null on every refresh after the initial ingest. This is a real second call site, not an
  edge case — both write paths need the same one-line count.
- **Backfill:** existing cached rows have `total_seats = NULL` until their next sweep/refresh touches
  them (same "accept blank until next refresh" precedent 47a's §5 used for the Hoyts/Reading
  `cinemaName` gate — no backfill migration script required, no blocking manual re-ingest).

### 4.3 API-side handling of `NULL`/not-yet-backfilled rows

`soldHeldPct` in the response is `number | null` (§1.2). It is `null` whenever:

- The date's contributing sessions all have `total_seats IS NULL` (pre-migration rows not yet
  refreshed), OR
- `total_seats <= 0` (defensive, mirrors `leadtime.ts`'s own `soldPct()` contract: "0 when totalSeats
  <= 0" — but this API returns `null` rather than a fabricated `0`, since a `0` sold/held reading is a
  real claim ("fully available") that the API must not assert when the number literally isn't there).

When multiple sessions on the same date have a mix of `total_seats` present/absent, aggregate only
over the sessions that HAVE it (documented partial-data behavior, not silently dropping the whole
date to `null` — a date with 3 sessions where 2 have real capacity data still gets a
`soldHeldPct` from those 2).

Formula per date (reusing `leadtime.ts`'s `soldPct` rounding convention exactly:
`round(100 * (total - available) / total)`): sum `total_seats` and `(total_seats - seats_available)`
across the date's sessions that have non-null `total_seats`, then apply the same rounding — this is
an aggregate soldPct across the date's houses, not an average of per-session percentages (avoids
skew from a tiny 20-seat session sitting next to a 300-seat IMAX house on the same date).

## 5. Per-day party — explicit non-goal (with the additive-param escape hatch)

The locked spec doesn't ask for per-day party on this endpoint, and the 2026-07-02 build-plan
revision (decision 3) is explicit: *"Party shape: single `party` size on the date-availability
endpoint... Per-day on the date module is a later additive parameter, not a v1 requirement."*
Reading the actual code (§2 above) confirms this is NOT trivial to add server-side today: `party` is
baked into a single `findAdjacentBlocks(..., { size: party })` call per session inside the
per-session `SessionAvailability` build — supporting a different party size per calendar date would
mean re-running the whole session-seat fetch + adjacency search once per distinct requested size
(e.g. if the organiser's steppers vary 2-7 across a week, that's up to 6x the adjacency work per
request), not a parameter substitution. This is real additional engine work, not a query-string
change.

**Verdict: stays a non-goal for v1**, exactly as decided. If it's ever wanted: spec it as an
*additive* param, e.g. `partyByDate=2026-07-16:3,2026-07-17:5` (or a JSON body if the querystring gets
unwieldy), computed by grouping sessions by date first and running `findAdjacentBlocks` once per
distinct requested size within that date's session set (not once per session) to bound the fan-out —
but this contract does not commit to that shape now; it's a future issue, not hidden scope here.

## 6. UI consumption notes

**Compact date strip** (option detail, per Slice 4's wireframe reference) and **movie header
summary** both consume the same `/availability` response — no separate endpoint per surface.

- **Header summary string** (exact form from the locked spec, reproduced here as the copy contract):
  `"Earliest 2 good seats: Tue 16 Jul (14 days out) · 81% sold/held as of 2h ago"`
  - `"Earliest {party} good seats"` — `party` from the response.
  - `"Tue 16 Jul"` — formatted from `earliest.date` (client-side day-name/date formatting, same
    convention `apps/web/src/format.ts`'s `formatTime`/date helpers already use elsewhere — no new
    date-formatting utility needed if one already exists there).
  - `"(14 days out)"` — `earliest.leadDays` (or `earliestLeadDays` top-level field — they're the same
    value; expose both for convenience, top-level `earliestLeadDays` saves the client a lookup into
    the `dates` array).
  - `"81% sold/held as of 2h ago"` — `earliest.soldHeldPct` + a relative-time render of
    `earliest.asOf`. **If `soldHeldPct` is `null`** (§4.3 — pre-backfill row), drop that clause
    entirely rather than rendering "null% sold/held" or fabricating a number: `"Earliest 2 good
    seats: Tue 16 Jul (14 days out)"` with no trailing sold/held clause. Never show a soldHeldPct the
    API didn't actually send.
  - When `earliest` is `null` (no `good-block` date in range): header falls back to the honest-state
    copy already established in Slice 3 ("no great seats" pattern) — e.g. *"No good {party}-seat block
    found in the next {N} days"* — not a blank header.
- **Date strip**: one cell per `dates[]` entry, keyed by `state` for styling (5 exhaustive visual
  states, §3), each cell's tooltip/label showing `leadDays` and, when present, `bestBlockScore`/
  `soldHeldPct`. `not-cached` cells render per §3.1's three sub-cases (beyond-horizon / not-yet-ingested
  / no-sessions-that-day) computed client-side from `horizonDate`/`maxCachedDate` — the API does not
  send a 6th state string for this, per the locked spec's "states EXHAUSTIVE" framing (5, not 7).

**Copy discipline (locked, non-negotiable per the #47 comment):**
- "sold/held now" / "sold/held" — never "sold out," never "booking fast," never any velocity/trend word.
- "as of {relative time}" — always attach a timestamp to any sold/held number; never present it as a
  live/current fact without the "as of" qualifier.
- **Never forecast language.** No "likely," "expect," "will sell," "act now," "before it sells out."
  The `timeline`/`dates` payload is a snapshot, not a prediction — `leadtime.ts`'s own module comment
  says as much ("Deterministic... this module only aggregates").
- No live forward scan triggered from any UI control on this page, ever, in v1 — every date strip
  interaction reads from the ONE `/availability` response already fetched; there is no "check live"
  button.

## 7. Non-goals (explicit)

- No live adapter calls, ever (cache-only, same as `/together`/`/options`).
- No Nearby/Split date-availability answer — Together-only, per the 2026-07-02 revision. A date with
  a `no-qualifying-block` state may still have decent Nearby/Split options; those live only in
  `/options`'s per-session fit tier, not in this date summary. This is a known, accepted honesty gap
  for v1 (explicitly named in the build-plan revision, not rediscovered here).
- No per-day/date-varying party (§5) — additive-param escape hatch documented, not built.
- No date-range query params (`dateFrom`/`dateTo`) — the response always covers the full cached
  horizon for the movie(+cinema); no sub-window requests.
- No 6th "beyond horizon" state — that distinction is copy-only, computed client-side from fields
  already in the payload (§3.1), not a new enum value.
- No modification to `packages/core/src/leadtime.ts` or `scripts/lead-time.ts` (§2, §0) — both stay
  exactly as-is; this contract only adds a new DB-backed caller.
- No historical/predictive charting — `dates[]` is a current snapshot across cached sessions, not a
  time series of past sold-through rates.

## 8. Integration checklist — shared fixture

Extends the 47a §6 fixture (same movie "Dune: Part Two", same three chain sessions) with date-level
framing. Seed data (conceptually):

- `today` = `2026-07-14` (Sydney), `REFRESH_HORIZON_DAYS` = 35 → `horizonDate` = `2026-08-18`.
- `maxCachedDate` = `2026-07-30` (ingester hasn't reached the far edge of the horizon yet).
- **2026-07-14 (today):** one Event session, `total_seats = 120`, `seats_available = 8`,
  `session_seats` gives no run of 3 in-zone (party=3) → `no-qualifying-block`. `soldHeldPct` =
  round(100*(120-8)/120) = `93`. Since `93 >= AVAILABILITY_SOLD_HELD_THRESHOLD_PCT` (90 default),
  state resolves to **`sold-held-now`** instead (state-selection order, §3), not
  `no-qualifying-block` — exercises the threshold boundary.
- **2026-07-16:** two sessions (Event IMAX, Village Vmax). Event has a qualifying party-3 block
  (avgScore 91); this date's `total_seats`/`seats_available` give `soldHeldPct = 42`. → `good-block`,
  `bestBlockScore = 91`, `earliest`/`earliestLeadDays = 2`.
- **2026-07-17:** one session, `total_seats = NULL` (pre-migration row, not yet refreshed) →
  `soldHeldPct: null` in the response regardless of its block state — exercises §4.3.
- **2026-07-14 through 2026-07-30 minus the above:** remaining dates with zero cached sessions but
  `date <= maxCachedDate` → `not-cached`, client-side copy "no sessions" (§3.1 third sub-case).
- **2026-07-31 through 2026-08-18:** `date > maxCachedDate` but `<= horizonDate` → `not-cached`,
  client-side copy "not yet checked" (§3.1 second sub-case).
- **2026-08-19 onward:** not present in `dates[]` at all (`horizonDate` is the hard upper bound of the
  array — the response never emits rows past its own advertised horizon); client-side copy for
  anything the user might ask about beyond that is "beyond current cache horizon" (§3.1 first
  sub-case), reasoned from the absence + `horizonDate` rather than from a row.
- **A session whose freshest `fetched_at` is > `freshnessStaleMs()` old:** that date's state is
  `stale` regardless of its block/sold-held facts (state-selection order takes `stale` before
  `good-block`/`sold-held-now`) — exercises the priority rule.

**Checklist:**
- [ ] `earliest`/`earliestLeadDays` match the first `good-block` row in `dates` (chronological, not
      best-score).
- [ ] All 5 states reachable in tests from this fixture (`good-block`, `no-qualifying-block`,
      `sold-held-now`, `stale`, `not-cached`).
- [ ] `sold-held-now` vs `no-qualifying-block` boundary exercised at `AVAILABILITY_SOLD_HELD_THRESHOLD_PCT`.
- [ ] `soldHeldPct: null` for rows with no `total_seats` data; never a fabricated `0`.
- [ ] `not-cached` client-side copy correctly branches on `horizonDate`/`maxCachedDate` for all three
      sub-cases (beyond-horizon / not-yet-ingested / no-sessions-that-day).
- [ ] `stale` takes priority over `good-block` in the state-selection order.
- [ ] Missing `movieKey` → 400. No DB pool wired → 503. Over rate limit → 429.
- [ ] `dates[]` spans every calendar day from Sydney-today to `maxCachedDate ?? horizonDate` inclusive,
      no gaps.
- [ ] Odyssey rehearsal: seed a session ≥14 days out at IMAX Sydney (`cinemaId=96`) with a qualifying
      2-seat block, confirm `/availability?movieKey=event:19797&party=2&minScore=60&cinemaId=96`
      answers `earliest`/`earliestLeadDays`/`soldHeldPct` consistently with
      `tsx scripts/lead-time.ts --movieId 19797 --cinemaId 96 --party 2 --minScore 60` run the same
      moment (Slice 6's cross-check requirement, pulled forward into this contract's own test plan).
