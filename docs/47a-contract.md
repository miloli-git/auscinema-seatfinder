# #47a — `/options` + `/catalog` contract (movie-forward entry, first slice)

Handed to two builder agents (API, web) who do not talk to each other. Read this file fully before
starting either side. Locked spec: `docs/v1-close-plan.md` Slice 3. Reference: `design/journey/04-wireframes-c1-c2.md`.

## 0. What exists today (read before objecting to a decision below)

- `/together` (`packages/api/src/index.ts:652`) is the closest cousin: cache-only, single scalar
  `party`/`minScore`, `findAdjacentBlocks` for adjacency, `computeFreshness` for the freshness object,
  `approximateAdjacency: chain === "hoyts"` as the geometry-confidence proxy.
- `/catalog` (`:764`) returns distinct `movies`/`cinemas`/`dates` for the whole cache (optionally
  filtered by `chain`), plus `horizonDate`/`maxCachedDate`.
- **The Together/Nearby/Split fit-tier algorithm referenced in the locked spec and in
  `design/journey/03-flows-and-concepts.md` / `04-wireframes-c1-c2.md` does not exist in code.**
  `/together` only ever computes ONE block at the requested `party` size (Together-or-nothing). There
  is no "existing group-fit logic" to reuse for Nearby/Split — §3 below defines it from scratch.
- **Day-varying per-day headcounts do not exist in code either**, despite the locked spec's phrase
  "existing `/together` day-varying support." `/together` takes one scalar `party`. §2 below states
  the real scope for 47a given this.
- **`cinemaName` is empty for Hoyts and Reading at the adapter level**, not just a UI mismatch:
  `packages/adapters/hoyts/src/index.ts:188` and `packages/adapters/reading/src/index.ts:302` both
  hardcode `cinemaName: ""`, while Event (`:177`) and Village (`:217`) populate a real name. This means
  `sessions.cinema_name` is NULL/empty for those two chains at ingestion — §4 makes this an explicit
  gate, not a client-side fix, per the task's framing of #67.
- `sessions.format` (TEXT column) stores `session.format.raw || session.format.kind`
  (`packages/ingester/src/sweep.ts:64`) — the structured `{kind, raw}` is flattened to one string at
  ingestion. `apps/web/src/format.ts`'s rank/large-format helpers take the structured object, so
  `/options` cannot just forward that column and expect the client to reuse `format.ts` unmodified.
  §1.4 defines a server-side classifier over the flattened string instead.

## 1. `GET /options`

Cache-only (no live adapter calls — `requirePool()` pattern from `/together`). Rate-limited by the
existing global per-IP limiter (120 req/min default, `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS` env).

### 1.1 Query params

| param | type | required | default | notes |
|---|---|---|---|---|
| `movieKey` | string | yes | — | `"<chain>:<movieId>"`, see §3. 400 if missing or malformed (no `:`, empty chain, empty id, or chain not in `event\|hoyts\|reading\|village`). |
| `party` | int | no | `2` | mirrors `/together`: `Math.max(1, parsed ?? 2)`. Single scalar — no per-day map (see §1.2). |
| `minScore` | int | no | `74` | mirrors `/together`'s current default. |
| `chain` | string | no | derived from `movieKey` | `movieKey` already encodes chain; an explicit `chain` param is NOT accepted — a caller cannot ask for a movie under a different chain than its key. Reject (400) if present and mismatched. |

No `cinemaIds`, `dateFrom`, `dateTo` in 47a — the option list is "all cached (cinema, session)
candidates for this movie," full stop; the client applies no server-side date/cinema narrowing this
slice (matches the locked spec: "option list = (cinema, session) candidates from cache").

### 1.2 Group mode / per-day headcounts — explicit non-goal

The locked spec's "Plan group mode with per-day steppers (existing `/together` day-varying support)"
does not correspond to any real backend capability (see §0). For 47a:

- The per-day stepper UI is buildable and "reachable and functional" per the Slice 3 acceptance line —
  it is a UI affordance, not a wired ranking input.
- `/options` takes exactly one `party` value, same as `/together` today. The web builder is responsible
  for choosing what single number to send (recommended: max of the entered per-day counts, since that's
  the binding constraint for "most together"); this contract does not mandate a specific selection rule
  beyond "single scalar in, single scalar out."
- True per-day ranking (a different fit tier per session date, keyed off that day's headcount) is
  explicitly OUT OF SCOPE for 47a and is not a hidden requirement — do not build it into either side.

### 1.3 Response shape

```ts
interface OptionsResponse {
  movieKey: string;
  movieTitle: string;         // movie_name for this (chain, movieId), NULLS LAST per /catalog convention
  party: number;
  minScore: number;
  count: number;
  options: Option[];
  freshness: Freshness;       // byte-identical shape to /together's freshness object
}

interface Option {
  chain: "event" | "hoyts" | "reading" | "village";
  cinemaId: string;
  cinemaName: string;         // NEVER "" or null in the response — see §4
  sessionId: string;
  startsAt: string;           // session.start_time, local-wall-time-with-fake-Z, same convention as /together
  date: string;                // YYYY-MM-DD, same convention as /catalog/sessions.date
  format: string;               // raw stored string (sessions.format) — may be "", "standard", "IMAX", etc.
  isLargeFormat: boolean;      // server-computed, see §1.4
  formatRank: 0 | 1 | 2;       // 2 = IMAX, 1 = Vmax/Xtremescreen/other-large-format, 0 = standard/unknown — see §1.4
  bestBlockScore: number | null;   // avgScore of the best adjacent block AT `party` size; null if no block of that size exists
  bestBlockSize: number | null;    // == party when bestBlockScore is non-null (Together case); the actual found size when Nearby/Split (see §2)
  fitTier: "together" | "nearby" | "split";
  togetherCount: number;       // seats coverable per §2, capped at `party`
  geometryConfidence: "exact" | "approximate"; // "approximate" iff chain === "hoyts", mirrors /together's approximateAdjacency
  freshness: { asOf: string; state: "fresh" | "stale" | "not-cached" }; // PER-OPTION, derived from this session's own fetched_at — see below
  bookingUrl: string;
}
```

Per-option `freshness.state`: `"not-cached"` is impossible for a row that exists (it came from the
cache); it is reserved for the whole-response `freshness` object's `coverage` semantics, not per-card.
Per-card states are only `"fresh"` (session's `fetched_at` age < `TOGETHER_FRESHNESS_STALE_MS`, default
2h — reuse `freshnessStaleMs()`) or `"stale"` (older). `asOf` = that session's own `fetched_at` (ISO
UTC instant), NOT the whole-response `freshness.oldestFetchedAt`. Compute per-card so two sessions in
the same response (one just refreshed, one stale) render honestly on their own cards, independent of
the top-level `freshness` block (which stays as today: aggregate, for a page-level banner).

### 1.4 Format rank / large-format classification (server-side, over the flattened string)

Given `sessions.format` is already flattened to a bare string at ingestion (§0), classify it directly —
do not attempt to reconstruct `ScreenFormat.kind`:

```ts
function classifyFormat(raw: string): { formatRank: 0 | 1 | 2; isLargeFormat: boolean } {
  const s = raw.trim().toLowerCase();
  if (s === "" || s === "standard") return { formatRank: 0, isLargeFormat: false };
  if (s === "imax") return { formatRank: 2, isLargeFormat: true };
  if (s.includes("vmax") || s.includes("v-max") || s.includes("xtreme")) return { formatRank: 1, isLargeFormat: true };
  // any other non-empty, non-standard label (goldclass, premium, titan xc, unknown "other" with a raw
  // label) — mirrors format.ts's isLargeFormat rule for kind="other": non-empty raw = large format.
  return { formatRank: 1, isLargeFormat: true };
}
```

"Best screen" lens = sort by `formatRank` desc, then `bestBlockScore` desc (nulls last). Known
limitation, accepted for 47a: this is a heuristic over a lossy column (kind was discarded at
ingestion — §0); it cannot distinguish "goldclass" from "titan xc" the way the original `ScreenFormat`
could. Not a blocker; flag as a follow-up if lens accuracy complaints show up (fix = persist
`format_kind` alongside `format` at ingestion, a small ingester patch, out of scope here).

### 1.5 Fit tier algorithm (§2 — NEW, since none exists — see §0)

Computed per session from `session_seats`, reusing `findAdjacentBlocks` (`packages/core/src/blocks.ts`)
exactly as `/together` does, but trying decreasing sizes instead of only the exact `party` size:

1. Run `findAdjacentBlocks(seats, { minScore, size: party })`. If it returns ≥1 block → **`together`**,
   `togetherCount = party`, `bestBlockScore` = that block's `avgScore`, `bestBlockSize = party`.
2. Else, for `size` from `party - 1` down to `2`, run `findAdjacentBlocks(seats, { minScore, size })`.
   The first size that returns ≥1 block → **`nearby`**, `togetherCount = size`, `bestBlockScore` = that
   block's `avgScore`, `bestBlockSize = size`. (Party sizes of 1 skip this loop entirely — go straight
   to step 3 if the size-`party` block in step 1 wasn't found, which can't happen when `party === 1`
   and any in-zone seat exists, since `findAdjacentBlocks` with `size:1` matches any single in-zone seat.)
3. Else (no run of 2+ found) → **`split`**, `togetherCount` = count of individual in-zone available
   seats (`score >= minScore`) capped at `party`, `bestBlockScore = null`, `bestBlockSize = null`.

This is a genuinely new algorithm being specified by this contract, not a port of existing logic —
both builders must implement/test against exactly this, not "whatever `/together` already does."

**"Most together" lens** sort: `fitTier` rank (`together` > `nearby` > `split`) desc, then
`togetherCount` desc, then `bestBlockScore` desc (nulls last), then `startsAt` asc. Hoyts rows
(`geometryConfidence: "approximate"`) are NOT excluded or re-sorted specially — the client renders the
existing `(~)` lower-confidence affordance per the wireframe; the API does not down-rank them.

### 1.6 Other lens sort ownership (server vs client)

| Lens | Sort owner | Rule |
|---|---|---|
| Best seats | **client** | `options` array is NOT pre-sorted for this lens; client sorts by `bestBlockScore` desc (nulls last, i.e. `split` rows sink) |
| Best screen | **client** | sort by `formatRank` desc, then `bestBlockScore` desc |
| Soonest good | **client** | filter to `bestBlockScore !== null` (a qualifying block exists), sort by `startsAt` asc; if zero rows qualify, client falls back to full list sorted by `startsAt` asc and shows the "no great seats" honest state, per Slice 3 §"honest states" |
| Most together | **server** | `options` array's DEFAULT order (as returned) is the "most together" ranking from §1.5, since it needs the tier computed server-side anyway and is the natural default for group mode |

Rationale: only "most together" needs a ranking that can't be derived from fields the client already
has in a trivial comparator; giving the server the default order there (rather than a 5th explicit
`?sort=` param) keeps the contract small. The other three lenses are one-line client comparators over
fields already in the payload — no round-trip needed when the user flips a chip.

### 1.7 Errors

Same centralised shape as every other route (`app.setErrorHandler`, `{ error: string }` body):

- `400` — missing/malformed `movieKey`; `chain` param present and inconsistent with `movieKey`.
- `503` — `database not configured` (no pool wired), identical to `/together`/`/catalog` today.
- `429` — rate limit exceeded (`{ error: "rate limit exceeded" }`), same global limiter as every route.
- No adapter-specific errors are possible (cache-only; no `UpstreamError` path).

## 2. `/catalog` extension

Add one new array, `titles`, alongside the existing `movies`/`cinemas`/`dates`/`horizonDate`/`maxCachedDate`
(none of the existing fields change shape — purely additive):

```ts
interface CatalogResponse {
  movies: Array<{ id: string; name: string | null; chain: string }>; // unchanged
  cinemas: Array<{ id: string; name: string | null; chain: string }>; // unchanged
  dates: string[];         // unchanged
  horizonDate: string;     // unchanged
  maxCachedDate: string | null; // unchanged
  titles: CatalogTitle[];  // NEW — what Screen 0's movie list actually renders
}

interface CatalogTitle {
  movieKey: string;        // "<chain>:<movieId>", see §3
  chain: "event" | "hoyts" | "reading" | "village";
  title: string;            // movie_name; "" if genuinely null in cache (rare — do not coalesce to movieId)
  sessionCount: number;     // count of live (non-tombstoned, non-past) sessions for this (chain, movieId)
  // No poster field: cache has no poster/image column anywhere in the schema. Not a 47a gap to fix —
  // genuinely not available data. Omit; do not stub a placeholder URL.
}
```

`titles` is derived with the same `DISTINCT ON (chain, movie_id)` + liveness filter (`disappeared_at IS
NULL AND date >= today`) that `/together` already applies, NOT the existing unfiltered `movies` query
(which has no liveness filter and predates this need) — Screen 0 must not show a title with zero
bookable sessions left. `sessionCount` is a `COUNT(*) ... GROUP BY chain, movie_id` over that same
liveness-filtered set.

`chain` param on `/catalog` behaves as today (optional filter); when supplied, `titles` is scoped to it
same as `movies`/`cinemas` are.

## 3. `movieKey`

Definition: **`"<chain>:<movieId>"`**, e.g. `"event:12345"`, `"hoyts:987"`. Per-chain, stable (as
stable as the chain's own `movie_id`, which is chain-native and doesn't change across ingests), URL-safe
(`chain` is one of 4 known lowercase tokens, `movieId` is already used raw in existing query params like
`/sessions?movieId=`, so no extra encoding is introduced beyond standard URL query-encoding of the
whole value if the id itself contains `:` or `&` — none of the four chains' ids do today, but the client
must still call `encodeURIComponent(movieKey)` when building the query string, not assume it's always
bare-safe).

**No cross-chain merge.** Each `(chain, movieId)` pair is its own `movieKey` and its own catalog/options
entry — this is unchanged from the locked spec's explicit non-goal (#61). "Dune: Part Two" at Event and
"Dune: Part Two" at Village are two different `movieKey`s, two different `/options` calls if the user
picks both.

**Trivial-equality grouping is client-only, display-only, and never changes a key.** On Screen 0, the
web builder groups `titles` entries for VISUAL presentation when `normalize(a.title) === normalize(b.title)`
(`normalize` = trim, lowercase, collapse whitespace — no fuzzy matching, no punctuation stripping beyond
that; anything not trivially identical after that normalization is shown as two separate rows, per the
locked spec's "otherwise show both"). Grouped rows still carry their own distinct `movieKey`s; picking a
grouped title still means picking one specific chain's `movieKey` (e.g. render as one row with a chain
picker, or one row that expands — implementation detail left to the web builder, NOT specified here
since it's pure UI and doesn't affect the API contract).

## 4. Non-goals (explicit)

- No live adapter calls from `/options` or the `/catalog` extension — cache-only, same as `/together`.
- No cross-chain movie identity resolution (#61 stays deferred).
- No RSVP / roster / must-have-people layer.
- No per-day/day-varying party ranking (§1.2).
- No 5th "lead time" lens and no date-availability module — that's #47b, a separate contract.
- No poster/image field (§2 — data doesn't exist in the cache).

## 5. Blocking dependency: `cinemaName` for Hoyts/Reading (#67)

This is called out as a GATE, not a suggestion, because the task explicitly requires `/options` to
carry a reliably populated `cinemaName` for all four chains, and the root cause is upstream of both
builders (§0):

- `HoytsAdapter`/`ReadingAdapter` hardcode `cinemaName: ""` on every `Session` they emit
  (`packages/adapters/hoyts/src/index.ts:188`, `packages/adapters/reading/src/index.ts:302`), vs.
  Event's `str(cm.Name) ?? ""` (`:177`) and Village's `str(cinema.name) ?? ""` (`:217`), which populate
  a real value from the chain's own cinema-list response.
- Because ingestion persists `session.cinemaName` straight into `sessions.cinema_name`
  (`packages/ingester/src/persist.ts:57`), every cached Hoyts/Reading row already has an empty name —
  no amount of API-layer joining fixes it without a source of truth for the real name.
- **Required fix (adapter-level, NOT part of this docs-only contract, must land before `/options`
  ships):** `HoytsAdapter`/`ReadingAdapter` must populate `cinemaName` from their own cinema-list call,
  mirroring Event/Village's pattern. This is a small, contained fix in two adapter files plus a
  re-ingest to backfill existing cached rows (or accept that pre-fix rows show blank until their next
  refresh).
- `/options` and the `/catalog` `titles`/`cinemas` fields must NEVER emit `""` or `null` for
  `cinemaName` once this fix lands. Until it lands, `/options`'s API builder should treat a blank
  `cinema_name` as a hard signal something upstream is broken, not something to silently coalesce to
  `cinemaId` (that would just re-hide #67 behind a new surface, which the task explicitly says not to do).

## 6. Integration checklist — shared fixture

Both builders test against this exact fixture. Seed data (conceptually — one movie, three chains, one
Hoyts row to exercise `approximate`/blank-until-fixed cinemaName, one `split` row, one `not found` party
size):

**Seed:**
- `movieKey = "event:555"`, title "Dune: Part Two", party=2, minScore=74.
- Session A: Event, cinemaId `"12"`, cinemaName `"Event George St"`, format `"IMAX"`, seats scored so a
  party-of-2 block exists (avgScore 91) → `together`.
- Session B: Hoyts, cinemaId `"88"`, cinemaName `""` (pre-#67-fix state — see §5), format `""`
  (standard), seats scored so no party-of-2 block exists but a size-1 in-zone seat run does NOT chain
  to 2 → actually seed so exactly one qualifying size-1 seat and one isolated in-zone seat two rows away
  exist (no adjacency of 2) → `split`, `togetherCount = 2` capped from 2 found isolated in-zone seats.
- Session C: Village, cinemaId `"40"`, cinemaName `"Village Crown"`, format `"Vmax"`, seats scored so a
  block of exactly 1 (not 2) is the largest run → `nearby`? No — `nearby` requires size ≥ 2 by
  definition (§1.5 step 2 starts at `party - 1` down to `2`); a largest run of exactly 1 falls through
  to `split` with `togetherCount = 1`. Use this to seed the `nearby` case at party=3 instead (see below).

**Fixture: `party=3` to get a real `nearby` example** (cleaner than forcing party=2 to skip straight to
split) — Session C above: Village, seats give a run of exactly 2 in-zone contiguous seats but not 3 →
`nearby`, `togetherCount = 2`, `bestBlockSize = 2`.

**Example response** (`GET /options?movieKey=event%3A555&party=3&minScore=74`):

```json
{
  "movieKey": "event:555",
  "movieTitle": "Dune: Part Two",
  "party": 3,
  "minScore": 74,
  "count": 3,
  "options": [
    {
      "chain": "event",
      "cinemaId": "12",
      "cinemaName": "Event George St",
      "sessionId": "evt-9001",
      "startsAt": "2026-07-21T19:40:00.000Z",
      "date": "2026-07-21",
      "format": "IMAX",
      "isLargeFormat": true,
      "formatRank": 2,
      "bestBlockScore": 91,
      "bestBlockSize": 3,
      "fitTier": "together",
      "togetherCount": 3,
      "geometryConfidence": "exact",
      "freshness": { "asOf": "2026-07-21T02:10:00.000Z", "state": "fresh" },
      "bookingUrl": "https://www.eventcinemas.com.au/Ticketing/checkout/evt-9001"
    },
    {
      "chain": "village",
      "cinemaId": "40",
      "cinemaName": "Village Crown",
      "sessionId": "vil-4410",
      "startsAt": "2026-07-21T21:00:00.000Z",
      "date": "2026-07-21",
      "format": "Vmax",
      "isLargeFormat": true,
      "formatRank": 1,
      "bestBlockScore": 78,
      "bestBlockSize": 2,
      "fitTier": "nearby",
      "togetherCount": 2,
      "geometryConfidence": "exact",
      "freshness": { "asOf": "2026-07-20T23:55:00.000Z", "state": "stale" },
      "bookingUrl": "https://www.villagecinemas.com.au/checkout/vil-4410"
    },
    {
      "chain": "hoyts",
      "cinemaId": "88",
      "cinemaName": "Hoyts EQ",
      "sessionId": "hoy-2207",
      "startsAt": "2026-07-21T20:15:00.000Z",
      "date": "2026-07-21",
      "format": "",
      "isLargeFormat": false,
      "formatRank": 0,
      "bestBlockScore": null,
      "bestBlockSize": null,
      "fitTier": "split",
      "togetherCount": 2,
      "geometryConfidence": "approximate",
      "freshness": { "asOf": "2026-07-21T01:00:00.000Z", "state": "fresh" },
      "bookingUrl": "https://www.hoyts.com.au/checkout/hoy-2207"
    }
  ],
  "freshness": {
    "oldestFetchedAt": "2026-07-20T23:55:00.000Z",
    "newestFetchedAt": "2026-07-21T02:10:00.000Z",
    "lastSuccessfulIngestAt": "2026-07-21T02:10:00.000Z",
    "coverage": { "event": "cached" }
  }
}
```

Note the fixture's `hoyts` row above shows `"cinemaName": "Hoyts EQ"` — i.e. it assumes §5's blocking
fix has landed. If the API builder starts work before that fix lands, they must NOT ship `/options`
with the pre-fix blank value; either land the adapter fix first, or block on it and say so.

**Checklist (both builders assert against this fixture):**
- [ ] `count` equals `options.length`.
- [ ] `together`/`nearby`/`split` rows all present and match §1.5's algorithm exactly (not just "a"
      fit-tier algorithm — the specific decreasing-size search).
- [ ] `hoyts` row has `geometryConfidence: "approximate"`; all others `"exact"`.
- [ ] `cinemaName` is non-empty on every row.
- [ ] Per-card `freshness.state` differs from the top-level `freshness` object's own aggregate implication
      when a session is individually stale but the response overall isn't (the Village row above).
- [ ] `formatRank`/`isLargeFormat` match §1.4's classifier for `"IMAX"`, `"Vmax"`, `""`.
- [ ] Missing `movieKey` → 400. No DB pool wired → 503. Over rate limit → 429.
- [ ] `/catalog`'s new `titles` array only lists movies with `sessionCount > 0` (liveness-filtered).
