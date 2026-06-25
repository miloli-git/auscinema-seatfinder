# together-movie-picker — contract (acceptance source of truth)

Tests AND implementation target THIS. Companion: `docs/movie-name-picker-scope.md` (Codex plan
review = SHIP WITH FIXES, folded in). Build targets:
- `apps/web/src/api.ts`
- `apps/web/src/components/TogetherView.tsx`
Frozen test (Codex authors): `apps/web/src/components/TogetherView.test.tsx` (REWRITE — ports the
3 existing invariant tests to the new UI + adds picker tests).

## Environment / runtime
- Vite/React 19 + TypeScript, strict. Test runner: **vitest** + @testing-library/react (jsdom).
- Test command (all of it must stay green): `cd apps/web && npm test` (`vitest run`) and
  `npm run typecheck` (`tsc --noEmit`).
- All local on `F:\dev\auscinema-seatfinder` (no SSH/CRLF concerns).

## API / behaviour

### api.ts — new
```ts
export interface CatalogMovie { id: string; name: string | null; chain: string }
export interface CatalogResponse {
  movies: CatalogMovie[];
  cinemas: CatalogMovie[];   // same shape; unused by the picker
  dates: string[];           // unused by the picker
}
/** GET /catalog[?chain=]. Throws (via getJson) on non-2xx, incl. 503 when the API has no DB pool. */
export function fetchCatalog(chain?: string): Promise<CatalogResponse>;
```
- Uses existing `getJson<T>(path, qs)`; set `chain` param only when provided.

### TogetherView.tsx — changed
The movie selector is the ONLY behavioural change. `movieId: string` stays the underlying state
and the sole thing `/together` consumes; scan / matrix / `scanned` snapshot / `reqSeq` guard /
drill are otherwise unchanged.

Catalog state (one object, keyed to the chain it was fetched for):
```ts
type CatalogState =
  | { status: "loading"; chain: Chain }
  | { status: "ready"; chain: Chain; movies: CatalogMovie[] }
  | { status: "error"; chain: Chain; error: string };
```
- On mount and on every chain change: fetch `/catalog?chain=<chain>`, request-guarded with a
  `live` flag AND keyed by chain, so a slow prior-chain response cannot overwrite the current
  chain's state.
- `status: "ready"` → render a controlled `<select>`:
  - first option `<option value="">Pick a movie…</option>` (blank; never auto-selects movie 0).
  - one option per movie, value = `movie.id`, label = `movie.name?.trim() || movie.id`.
    If two visible movies share a label, append ` (id)` to disambiguate.
  - selecting sets `movieId`.
  - empty `movies` array → blank option label becomes "No movies cached for this chain yet"
    and the select is effectively unusable (no raw-input fallback in this case — empty ≠ error).
- `status: "loading"` → disabled select with "Loading movies…" blank option.
- `status: "error"` (catalog fetch rejected — 503 no-DB / network) → DEGRADE: render the
  existing free-text movie-id `<input>` (placeholder `e.g. 19796`) bound to the **same `movieId`
  state**, plus a hint line. Capability never regresses.

### Chain switch = full reset boundary (Codex HIGH — non-negotiable)
On chain change, BEFORE/AROUND the catalog refetch:
- bump `reqSeq` (invalidate any in-flight `/together` so a late old-chain response is dropped),
- clear `movieId`, `scanned`, `results`, `drill`, scan `error`, and `loading`.
So a late Event `/together` response, or a minScore re-query against a stale `scanned`, can never
apply under Hoyts controls.

## Done-when (per behaviour, checkable)
- D1 `fetchCatalog("event")` → `GET /catalog?chain=event`; `fetchCatalog()` → `GET /catalog`.
- D2 catalog `ready` → movie `<select>` lists the catalog movies; selecting + Scan calls
  `getTogether` with the selected id.
- D3 catalog `error` → free-text id input present, Scan works against typed id, and the picker
  failure does NOT surface as "Scan failed".
- D4 chain switch refetches catalog for the new chain AND clears movieId/scanned/results/drill.
- D5 chain switch drops an in-flight `/together`: a late old-chain response does not render.
- D6 catalog fetch race: a slow old-chain `/catalog` cannot overwrite the new chain's catalog.
- D7 blank option present; initial `movieId===""` does not auto-select the first movie.
- D8 null-name movie renders its id as the label and is selectable.
- D9 empty catalog → "No movies cached…" state, NOT the raw-input fallback.
- D10 the 3 prior invariants still hold (ported to the new UI): empty-id Scan clears the matrix
  and makes no network call; minScore re-query uses the scanned snapshot not edited inputs;
  out-of-order re-query responses → latest wins, older late response ignored.

## Non-negotiables
- `movieId` is the single source of truth for the movie across BOTH the select and the raw-input
  fallback — never two parallel states.
- Builder MUST NOT modify the frozen test. If a test contradicts this contract → STOP and report.
- No new runtime deps. Native `<select>` (no combobox lib) for v1.
- Scan/`scanned`/`reqSeq`/minScore-snapshot semantics unchanged except for the chain-switch reset.

## Test requirements (for the test author — REWRITE TogetherView.test.tsx)
Mock BOTH `getTogether` and `fetchCatalog` from `../api`. Default the `fetchCatalog` mock to a
ready catalog; override per-test for error/empty/race cases.
1. catalog ready → select renders the mocked movies (by name); blank "Pick a movie…" option exists.
2. select a movie → Scan → `getTogether` called once with `movieId` = selected id.
3. catalog fetch rejects → raw-id text input (placeholder `e.g.`) is present; typing an id + Scan
   calls `getTogether`; no "Scan failed" banner appears from the catalog failure.
4. chain switch → `fetchCatalog` re-called with the new chain; a previously selected/scanned movie
   is cleared (scanned matrix gone, movieId reset).
5. chain switch with an in-flight `/together`: the late old-chain response must NOT render.
6. catalog race: old-chain `fetchCatalog` resolves AFTER a chain switch → new chain's catalog
   (not the stale one) is shown.
7. blank initial state: with a ready catalog and no selection, `getTogether` is not called and no
   movie is auto-selected (select value === "").
8. null-name movie → option label equals its id; selectable; Scan sends that id.
9. empty catalog (movies: []) → "No movies cached" text; raw input NOT shown.
10. PORT: empty-id Scan clears the stale matrix and makes no `getTogether` call.
11. PORT: minScore re-query uses the scanned snapshot, not edited-but-unscanned selection.
12. PORT: out-of-order re-query responses → latest wins, older late response ignored.
