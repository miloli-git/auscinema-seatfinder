# P0 live-recompute + date-fix — contract (acceptance source of truth)

Tests AND implementation target THIS. Branch `feat/together-live-recompute` (off
`feat/together-movie-picker`). Companion: `reviews/FRESHNESS-REVIEW.md` (Codex).

## Problem
The Together drill-in "confirm" fetches the live seat map but only re-checks the ONE cached
adjacency block; if any of those exact seats sold it dead-ends ("block gone — re-run the search",
which re-hits the same stale cache). The live map it just fetched is the source of truth and almost
always still has *other* adjacent pairs. Fix: recompute the block from the live map server-side,
reusing `core`'s `findAdjacentBlocks` (single-sourced; the web app does not import `core`).
Plus a trivial date-header fix (no month) and honest "moments ago" wording.

## Build targets
- `packages/api/src/index.ts` — extend `GET /seatmap`.
- `apps/web/src/types.ts` — extend `ScoredSeatMap` with the live block(s).
- `apps/web/src/api.ts` — `fetchSeatMap` gains optional `party`/`minScore`.
- `apps/web/src/components/TogetherDrillIn.tsx` — confirm uses the live block.
- `apps/web/src/components/TogetherView.tsx` — pass `party`/`minScore` to the drill-in.
- `apps/web/src/components/Matrix.tsx` — date label includes the month.

Frozen tests (Codex authors): `packages/api/src/seatmap.test.ts` (NEW), and REWRITE/EXTEND
`apps/web/src/components/TogetherDrillIn.test.tsx` + `apps/web/src/components/Matrix.test.tsx`.

## Environment / runtime
- API: Fastify + TS, `vitest` (`packages/api`, `npm test` = `vitest run`). Core helper
  `findAdjacentBlocks(seats: BlockSeat[], { minScore, size })` returns `SeatBlock[]` best-first;
  `BlockSeat = { id, rowLabel, row, col, score }`; `SeatBlock = { row, rowLabel, startCol, seatIds,
  avgScore, minScore }`. Already imported in `index.ts`.
- Web: Vite/React 19, `vitest` + @testing-library/react (`apps/web`). All local on F:.
- Whole monorepo must stay green: per-package `npm test` + root `npm run typecheck`/`build`.

## API — `GET /seatmap` extension
Today: `GET /seatmap?chain=&sessionId=` (+ scoring prefs) → `{ ...SeatMap, scored: {seat,score}[] }`.

Add OPTIONAL `party` + `minScore` query params (parsed identically to `/together`:
`party = Math.max(1, optInt ?? 2)`, `minScore = optInt ?? 74`). Behaviour:
- **`party` ABSENT → response unchanged** (back-compat; no `block`/`blocks` keys). This is the
  non-negotiable back-compat invariant — existing `/best`/seat-map-only callers must not change.
- **`party` PRESENT →** also compute live adjacency over the SAME scored seats already returned:
  map `scored` → `BlockSeat[]` (`{ id: seat.id, rowLabel: seat.rowLabel ?? "", row: seat.row,
  col: seat.col, score }`) exactly as `/together` does, then
  `findAdjacentBlocks(blockSeats, { minScore, size: party })`. Response gains:
  - `blocks: SeatBlock[]` — all qualifying live blocks, best-first.
  - `block: SeatBlock | null` — `blocks[0] ?? null` (convenience).
  - `party`, `minScore` — echo the values used.
- The recompute scores with the SAME `pref` the call already parsed → internally consistent with
  the returned `scored`. (v1 scoring-consistency assumption: the grid/ingester and the drill-in use
  the same default scoring profile; documented, per the freshness review.)

### Done-when (API)
- A1 no `party` → identical bytes to current `/seatmap` (no `block`/`blocks`/`party`/`minScore`).
- A2 `party=2&minScore=74` on a map with an available adjacent in-zone pair → `block` non-null,
  `block.seatIds.length === 2`, all its seats present+available in `scored`, `blocks[0] === block`.
- A3 a SOLD seat splitting a row → the block does not span the gap (mirrors core adjacency).
- A4 no qualifying run (party too big / all below minScore / fully sold) → `block: null`, `blocks: []`.
- A5 `party` present, `minScore` absent → defaults to 74; `party` absent but `minScore` present →
  still no blocks (party is the trigger).

## Web — drill-in live recompute (`TogetherDrillIn.tsx`)
The confirm must trust the LIVE map, not the cached block.
- New props: `party: number`, `minScore: number` (passed from `TogetherView` = `scanned.party`,
  current `minScore`).
- `fetchSeatMap(chain, sessionId, scoring, { party, minScore })` → response includes live `block`.
- `pick(result)`:
  - live `block` non-null → state `ok`; highlight **`block.seatIds` from the live response**
    (NOT `result.block.seatIds`). The booking link + map render as today.
  - live `block` null → state `gone`.
- Wording: the `ok` header and the `gone` message say availability is **"as of moments ago"** /
  "available moments ago" — never imply a guarantee. The `gone` copy drops "re-run the search"
  (that advice re-hit the stale cache); instead: "those seats just went — no adjacent {party} left
  in this session right now. Try another session."

### Done-when (web drill-in)
- W1 `pick` calls `fetchSeatMap` with the `party`+`minScore` props.
- W2 live `block` present → highlights the LIVE `block.seatIds` (even if they differ from the cached
  `result.block.seatIds`), state `ok`.
- W3 live `block` null → state `gone`, new copy (no "re-run the search"), party count shown.
- W4 confirm `ok` header contains the "moments ago" wording (no guarantee language).
- W5 `TogetherView` passes the scanned party + current minScore into `<TogetherDrillIn>`.

## Web — date header (`Matrix.tsx`)
`dateLabel("2026-07-02")` currently → `"Thu 2"` (no month). Change to include the abbreviated
month, UTC-stable: `"Thu 2 Jul"`.
- D1 `dateLabel` output for a known date contains the month abbreviation (`Jul`), weekday, day.
- D2 still UTC-derived (no TZ off-by-one) — a `...T00:00:00Z` date renders the same day everywhere.

## Non-negotiables
- `/seatmap` WITHOUT `party` is byte-identical to today (back-compat).
- Do NOT fork the adjacency algorithm — server-side reuse of `core.findAdjacentBlocks` only.
- The drill-in highlights the LIVE recomputed block, never the cached one, once a live map is in hand.
- Builder MUST NOT edit the frozen tests; if a test contradicts this contract, STOP and report.
- No new runtime deps.

## Test requirements (for the test author)
API (`packages/api/src/seatmap.test.ts`, stub adapter returning a designed SeatMap):
1. no `party` → response has no `block`/`blocks`/`party`/`minScore` keys (A1 back-compat).
2. `party=2` with an adjacent available in-zone pair → `block` non-null, 2 seatIds, `blocks[0]===block` (A2).
3. a sold seat mid-row → returned block doesn't bridge the gap (A3).
4. party too large / all-below-minScore / sold-out → `block:null`, `blocks:[]` (A4).
5. `minScore` defaults to 74 when omitted with `party` present; `minScore` alone (no party) → no blocks (A5).
Web drill-in (`TogetherDrillIn.test.tsx`, inject `fetchSeatMap`):
6. pick → `fetchSeatMap` called with the party+minScore props (W1).
7. live block whose seatIds DIFFER from the cached block → highlights the LIVE ids, state ok (W2).
8. live block null → `gone` state, copy has no "re-run the search", shows the party number (W3).
9. ok header has the "moments ago" wording (W4).
Web matrix (`Matrix.test.tsx`):
10. a date column header renders weekday + day + month abbrev (e.g. matches /Jul/) (D1).
Web view (`TogetherView.test.tsx` — only if needed to assert W5 without breaking the frozen picker suite):
11. the drill-in receives party (scanned) + minScore props (W5) — assert via the fetchSeatMap call args is acceptable.
