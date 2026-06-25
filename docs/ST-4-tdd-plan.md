# ST-4 TDD plan — Definition-of-Done contract

Status: **active** (authored 2026-06-25, after ST-0 verified). Drives #40, #39, #29 (which absorbs
#36/#37/#38). Read with `design/seats-together-design.md` § "ST-4 Web UI — LOCKED SPEC" and
`design/seats-together-handover.md`. This is a repo doc, not a GitHub issue — it is the target a
`/dual-harness` loop converges on. Companion to `docs/ST-3-api-contract.md` / `docs/codex-review-loop.md`.

## How to use (loop-runnable)
- Every acceptance criterion below has a **named test**. "Done" = every named test exists and is GREEN,
  plus the gate exit-conditions pass. No criterion is done until its test is green; no test is edited to
  make impl pass (see Invariants).
- Layers run **RED → GREEN → REVIEW**. Claude authors the failing test (RED) from this contract; Codex
  reviews the test against this doc *before* impl; impl turns it GREEN; Codex reviews the impl.
- Paired `[red]` then `[green]` commits per layer are the visible proof (public repo / portfolio).

## Invariants (do NOT violate)
1. The implementer never edits a test to make it pass. A wrong test is fixed in a separate, reviewed
   `[test-fix]` commit with a stated reason, before impl resumes.
2. Tests are authored from this frozen contract, not from the implementation.
3. Each layer is Codex-reviewed twice: test pre-impl, impl post-green. Codex prompts inline the
   contract/shapes (never "read the repo") per `.claude/memory/reference_codex_review_inline_contracts`.
4. Unattended smoke runs against a **local seeded pg fixture** (deterministic). The single **live-NAS
   browser smoke** is Milo's Gate 3 — not automated.

## Wire shapes this build pins (verified live 2026-06-25)
`/together?chain=…&party=…&minScore=…` → `{ party, minScore, count, results: TogetherResult[] }` where
each result is:
```jsonc
{
  "session": {
    "id": "15412843", "chain": "event", "movieId": "19796", "movieName": "Supergirl",
    "cinemaId": "96", "cinemaName": "IMAX Sydney",
    "date": "2026-06-28", "startTime": "2026-06-28T21:15:00.000Z",
    "format": "IMAX",          // STRING (or null) — diverges from web Session.format {kind,raw}
    "screen": null,            // web Session wants `screenName`
    "seatsAvailable": 322, "bookingUrl": "…", "seatAllocation": true
  },
  "block": { "row": -7, "rowLabel": "L", "startCol": -18,
             "seatIds": ["…"], "avgScore": 98, "minScore": 98 }  // OR absent after #39 = sold session
  "approximateAdjacency": false,
  "fetchedAt": "2026-06-25T01:04:22.774Z"
}
```
Web `Session` (target of Fork-1): `apps/web/src/types.ts` — `format: {kind,raw}`, `screenName?`, no `date`.

---

## Layer 1 (#39) — `/together` exposes matched no-block sessions  ·  api-contract, pg-backed
**Why:** the matrix cell needs `sold` (sessions exist, none bookable) vs `—` (no session). Today
`/together` drops blockless sessions, so the two are indistinguishable.

**Acceptance → tests** (file: `packages/api/src/together.test.ts`, disposable-pg via NAS docker
test-runner, pattern already in that file):
- `L1.1 returns matched session with block === null when the session has no available block`
- `L1.2 still returns block for sessions that have one (no regression)`
- `L1.3 count includes blockless sessions; results length === count`
- `L1.4 a movie/cinema/date with no session at all is simply absent (not a null row)`

**Contract:** a result keeps its `session` and sets `block: null` when no adjacency block ≥ party at
`minScore` exists. The `—` (no-session) case is the *absence* of a result, derived client-side from the
date axis. No new endpoint; same query params.

**Exit:** L1.1–L1.4 green; Codex confirms the response stays backward-compatible (existing
`together.test.ts` cases unchanged).

---

## Layer 2 (#29) — pure logic  ·  vitest, no DOM, no network
Files: `apps/web/src/together/{normalize,filters,matrix}.ts` + co-located `*.test.ts`.

**L2a Fork-1 normaliser** — `normalizeTogetherSession(raw): Session`
- `L2a.1 maps format string "IMAX" → {kind:"imax", raw:"IMAX"}` (reuse the kind mapping from the event
  adapter's `mapFormat` rules: vmax/goldclass/imax/standard/other; case+space-insensitive)
- `L2a.2 maps format null → {kind:"other", raw:""}`
- `L2a.3 maps screen→screenName; null screen → screenName undefined`
- `L2a.4 preserves id, cinemaId, cinemaName, startTime, seatsAvailable, bookingUrl, seatAllocation`
- `L2a.5 derives no `date` field reliance — date for filing comes from startTime slice (UTC)`

**L2b filters** (client-side, over the cache)
- `L2b.1 format predicate: multi-select; empty selection = all`
- `L2b.2 time-of-day: Any | Evenings(≥17:00 local) | Weekends(Sat/Sun)` — pin the tz handling: derive
  hour/day from `startTime`; document the UTC-vs-local caveat (cache start_time is approximate, v1 ok)
- `L2b.3 day+time presets compose (Evenings ∩ Weekends)`

**L2c `buildMatrix(results, {formats,timePreset,minScore}) → { cinemas[], dates[], cells }`**
- `L2c.1 cell = best available block among that (cinema,date)'s sessions in the filter → {kind:"score", avgScore, sessionCount}`
- `L2c.2 sessions exist in filter but none has a block → {kind:"sold"}`
- `L2c.3 no session in window → {kind:"empty"}` (the `—`)
- `L2c.4 rows = distinct cinemas (stable order), cols = date range (contiguous, even gaps)`
- `L2c.5 minScore is the caller's; buildMatrix does not re-filter blocks by score (the API already did)`
- `L2c.6 "best" tie-break: higher avgScore, then more sessions, then earlier date` (deterministic)

**Exit:** all L2 green; Codex reviews `buildMatrix` for the three cell states + determinism.

---

## Layer 3 (#29) — components  ·  vitest + @testing-library/react, jsdom
Files: `apps/web/src/components/{Matrix,MatrixCell,TogetherDrillIn}.tsx` + tests; extend `SeatMapView`.
- `L3.1 Matrix renders rows=cinemas, cols=dates; sticky first column present (mobile class)`
- `L3.2 cell renders score band / "sold" / "—" per cell.kind`
- `L3.3 clicking a score cell opens drill-in listing that cell's qualifying sessions (time·format·block avg·"as of")`
- `L3.4 (#36) SeatMapView accepts highlightSeatIds and applies a highlight class to exactly those seats`
- `L3.5 (#37) drill-in confirm requests /seatmap with the default scoring profile`
- `L3.6 (#38) when the live /seatmap no longer has the block, drill-in shows a "block gone" state`
- `L3.7 minScore control change calls the re-query handler (one /together call), not a client re-filter`

**Exit:** all L3 green; Codex reviews #36/#37/#38 acceptance wording vs tests.

---

## Layer 4 (#29) — Playwright E2E  ·  the acceptance test  ·  THE FIXTURE IS THE DoD
File: `apps/web/e2e/together.spec.ts`, run against the app wired to the **local seeded pg fixture**
(#40). Fixture must contain, deterministically:
- a **great-block cell** (a cinema/date whose best block avgScore ≥ 90),
- a **`sold` cell** (sessions present, all blockless — exercises #39),
- an **empty gap** (a date with no session for one cinema).

Flow asserted end-to-end:
- `L4.1 pick movie → matrix renders both seeded cinemas across the seeded date range`
- `L4.2 the three cell states are visually distinct (score / sold / —)`
- `L4.3 adjust minScore → a new /together request fires and the grid updates`
- `L4.4 apply a format filter and an Evenings filter → cells recompute client-side (no network)`
- `L4.5 click the great-block cell → drill-in → confirm → /seatmap shows the block highlighted`

**Exit (and the whole-epic acceptance):** L4.1–L4.5 green against the fixture. This is the contract's
"done". ⚠ The fixture content *defines* correctness — review the fixture before trusting green.

---

## #40 — web test harness (enabler, lands first)
- Add to `apps/web`: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`,
  `@playwright/test`. Wire `vitest.config.ts` (jsdom), test scripts, and a Playwright project.
- Seed fixture: a small SQL/JSON fixture + a loader that points the API at a local pg with the three
  cells above (reuse the disposable-pg pattern from `packages/api/src/together.test.ts`).
- `40.1 a trivial `*.test.ts` runs green under vitest` · `40.2 playwright launches the built app` ·
  `40.3 the seed fixture loads and /together returns the 3 designed cells`.
- **Exit:** harness green on an empty suite; fixture asserted. Unblocks L1∥L2.

## Sequence + gates
`#40 → {#39 L1 ∥ #29 L2} → #29 L3 → #29 L4 → Codex SHIP → auto-deploy → Milo browser smoke (Gate 3)`
- L2c `sold` test mocks the `block:null` flag until #39 is green, then integrates (the one cross-stream
  coupling).
- Human gates: **Codex SHIP** (whole diff) · **Milo browser smoke** (open seatfinder.miloli.org, matrix
  renders with both cinemas — `curl ≠ browser`). Do not autonomise across these.
