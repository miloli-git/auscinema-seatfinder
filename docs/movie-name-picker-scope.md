# Scope — Movie name-picker (Together mode)

Status: SCOPE (pre-build), Codex plan review = SHIP WITH FIXES (folded in below)
Branch (planned): `feat/together-movie-picker` off `main`
Issue: backlog item "movie name-picker" (primer top item)

## Problem

Seats-Together mode (`apps/web/src/components/TogetherView.tsx`) makes the user type a
**raw movie id** into a free-text input (`movieId` state, line ~126-129, placeholder
`e.g. 19796`). Nobody knows cinema movie ids. This is the single biggest UX gap in the
feature — it's the first field a real user hits and it's unusable without out-of-band
knowledge.

## Why /catalog is the right source

`GET /catalog?chain=<chain>` (`packages/api/src/index.ts:610-649`) already returns the
distinct movies present in the **DB cache**:

```
{ movies: [{ id, name, chain }], cinemas: [...], dates: [...] }
```

- Distinct by `(chain, movie_id)`, name de-drifted via `DISTINCT ON` (lowest non-null
  name per id), sorted by name.
- `name` can be `null`.
- 503 when no `DATABASE_URL` / pool absent.

Together mode **only scans the cache** (`/together` reads the same `sessions` table), so
`/catalog` is exactly the set of movies that are scannable. The picker and the scan can
never disagree. This is a better fit than best-seat mode's `/movies` endpoint, which is a
live per-(cinema,date) fetch and needs cinemas+date chosen first.

## Approach

Pure input-control swap. `movieId` stays the underlying state and the only thing
`/together` consumes, so the matrix / scan / minScore-snapshot logic is **untouched**.

### 1. `apps/web/src/api.ts`
Add:
```ts
export interface CatalogMovie { id: string; name: string | null; chain: string }
export interface CatalogResponse {
  movies: CatalogMovie[];
  cinemas: CatalogMovie[];   // same shape; unused here
  dates: string[];           // unused here
}
export function fetchCatalog(chain?: string): Promise<CatalogResponse> { ... } // GET /catalog[?chain=]
```

### 2. `apps/web/src/components/TogetherView.tsx`
- Fetch catalog on mount + on chain change, request-guarded with a `live` flag
  (mirror QueryForm's cinema-refetch effect at `QueryForm.tsx:85-101`).
- Replace the free-text Movie id `<input>` with a `<select>` of `catalog.movies`
  (already name-sorted server-side). Null-name rows render their `id` as the label so
  they stay selectable. Selecting sets `movieId`.
- **Chain switch = full reset boundary (Codex HIGH).** Not just `movieId`. On chain
  change: bump `reqSeq` (invalidate any in-flight `/together`), then clear `movieId`,
  `scanned`, `results`, `drill`, scan `error`, and `loading`. Otherwise a late Event
  `/together` response — or a minScore re-query against the stale `scanned` snapshot —
  applies under Hoyts controls. (This is a latent bug today, masked only because the
  free-text id makes cross-chain switching meaningless; the picker surfaces it.)
- **Catalog as one state object (Codex MEDIUM).** Model as
  `{ status: 'loading'|'ready'|'error', chain, movies, error }`, keyed to the chain it was
  fetched for. On fetch start/error, clear the prior chain's movies so Event options can't
  render under Hoyts. Catalog errors are **separate from scan `error`** — a picker-load
  failure must not show "Scan failed".
- **Graceful degrade:** catalog `status: 'error'` (503 no-DB, network) → render the raw-id
  text input bound to the **same `movieId` state** (one source of truth, not two) + a hint.
- **Select option model (Codex MEDIUM).** Controlled `<select>` with an explicit blank
  `<option value="">Pick a movie…</option>` so initial `movieId===""` never auto-selects
  the first movie; plus loading + empty-catalog placeholder text. Mirror `QueryForm.tsx:266`.
- **Label (Codex LOW):** `name?.trim() || id`. If two movies share a display name, append
  the id to disambiguate.

### 3. Tests (`apps/web/src/components/TogetherView.test.tsx`)
- picker renders catalog movies (mock `fetchCatalog`)
- selecting a movie then Scan calls `getTogether` with that id
- **chain switch invalidates an in-flight `/together`** (late old-chain response is dropped)
- **chain switch clears `scanned`/`results`/`drill`** → minScore change does not re-query the old chain
- **catalog fetch race**: a slow old-chain catalog cannot overwrite the new-chain catalog
- empty catalog → empty-state hint, does **not** fall back to raw id
- initial loaded select does **not** auto-select the first movie
- catalog error → raw-id text input bound to same `movieId`, Scan works, no "Scan failed" UI
- null-name movie renders id as label and is selectable
- select edit without Scan preserves the scanned-snapshot minScore behaviour

## Edge cases / decisions

- **Chain-scoped fetch** — fetch `/catalog?chain=<chain>`, refetch on change. Do not pull
  all-chains; the chain selector already narrows it.
- **Empty catalog** (chain cached nothing yet) — empty-state hint: "No movies cached for
  this chain yet." (together can only scan what's ingested — correct, not a bug).
- **Race** — chain-switch fetches guarded so a slow `event` fetch can't clobber a fast
  `hoyts` one.
- **No regression to scan flow** — `scanned` snapshot + minScore re-query (L3.7) only read
  `movieId`; the picker changes how it's set, not when scan fires.

## Out of scope (named so the diff stays small)

- Cross-chain "all movies" picker — that's #41 (Event multi-cinema fan-out) territory.
- Date / cinema pickers from `/catalog` (it returns them; backlog item is movie-only).
- Typeahead/combobox — plain `<select>` for v1. Filterable input is a fast-follow if a
  single-chain catalog turns out long.

## Open question for Codex

Plain `<select>` vs a filterable combobox for v1, given unknown single-chain catalog size?
Lean: `<select>` (simplest, accessible, sorted), filter as fast-follow.
