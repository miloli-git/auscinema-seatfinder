# #49 — IMAX surface/verify via a lead-time / pair-availability finder (acceptance source of truth)

Tests AND implementation target THIS. Issue #49. Branch `feat/49-imax-leadtime`. Base `main`.

**Why:** Sydney IMAX is already reachable through the Event adapter (cinemaId 96, true geometry). The
acceptance test that *verifies* it end-to-end is a real query: "2 seats in a reasonable location at IMAX
for The Odyssey — how far ahead do I need to look, given most are pre-booked?" That requires a capability
the product doesn't have yet: a **forward-scan lead-time finder** that, across upcoming sessions, finds
the earliest one with a qualifying adjacent block AND reports a per-session sold/availability timeline.
Decision (Milo): **general finder, report both** — soonest qualifying pair AND the busiest near-term
sessions.

## Architecture (two parts)
1. **Pure core — `packages/core/src/leadtime.ts`** — the analysis/aggregation logic. Deterministic, no
   network. **This is the dual-harness target** (Codex authors `packages/core/src/leadtime.test.ts`).
2. **Thin live CLI — `scripts/lead-time.ts`** — uses `defaultRegistry()`/the Event adapter to
   `listSessions` across a forward date range, `getSeatMap` per session, `scoreAvailableSeats` →
   `findAdjacentBlocks`, then calls the pure core and prints the report. **Not unit-frozen** — it is the
   live-integration acceptance gate (run against Odyssey@IMAX).

## Environment / runtime
- TS, `@auscinema/core`. Tests: `node --test` (the core convention), `node:test` + `node:assert/strict`,
  importing from `./leadtime.ts` (see `packages/core/src/blocks.test.ts` for the exact style).
- Reuse existing core: `findAdjacentBlocks(seats, {minScore,size})` → `SeatBlock[]` (best-first;
  `blocks.ts`), `scoreAvailableSeats(map, pref)` → `ScoredSeat[]` (scoring.ts), `SeatBlock` shape
  (`{ row, rowLabel, startCol, seatIds[], avgScore, minScore }`). Do NOT reimplement adjacency/scoring.

## API / behaviour — `packages/core/src/leadtime.ts` (export all; re-export from `index.ts`)

```ts
export interface SessionAvailability {
  sessionId: string;
  date: string;        // business date "YYYY-MM-DD"
  startTime: string;   // local wall time "YYYY-MM-DDTHH:MM"
  totalSeats: number;      // sellable capacity = available + taken; EXCLUDES spacers/structural.
                           // (Event CLI counts available+sold+unavailable — Event maps sold/held → "unavailable".)
  availableSeats: number;  // currently available
  blocks: SeatBlock[];     // findAdjacentBlocks output for (party, minScore), best-first; MAY be empty
}

export interface LeadTimeOptions {
  party: number;     // >= 1
  minScore: number;  // 0..100
  today: string;     // "YYYY-MM-DD" — injected for deterministic lead-day math (NEVER read a clock in core)
}

export interface SessionTimelineEntry {
  sessionId: string;
  date: string;
  startTime: string;
  totalSeats: number;
  availableSeats: number;
  soldPct: number;             // round(100 * (total - available) / total); 0 when totalSeats <= 0
  hasQualifyingPair: boolean;  // blocks.length > 0
  bestPairScore: number | null;     // blocks[0].avgScore ?? null
  bestPairSeatIds: string[] | null; // blocks[0].seatIds ?? null
}

export interface LeadTimeReport {
  party: number;
  minScore: number;
  sessionsScanned: number;
  sessionsWithPair: number;
  earliest: SessionTimelineEntry | null;  // chronologically-first session WITH a qualifying pair
  earliestLeadDays: number | null;        // whole days from `today` to earliest.date (>= 0); null if none
  busiest: SessionTimelineEntry | null;   // highest soldPct; ties → earliest chronologically; null if no sessions
  timeline: SessionTimelineEntry[];       // ALL sessions, sorted ascending by (date, then startTime)
}

export function buildLeadTimeReport(
  sessions: readonly SessionAvailability[],
  opts: LeadTimeOptions,
): LeadTimeReport;
```

## Done-when (per behaviour, checkable)
- `timeline` is ALL input sessions sorted ascending by `date` then `startTime`, regardless of input order.
- `earliest` = the chronologically-first session whose `blocks` is non-empty (NOT merely the first session). `null` if none qualify.
- `earliestLeadDays` = whole calendar days from `opts.today` to `earliest.date` (UTC-midnight date diff; `2026-06-28` → `2026-07-01` = 3). Clamp to `>= 0` (a past date → 0). `null` when `earliest` is null.
- `soldPct` = `Math.round(100 * (totalSeats - availableSeats) / totalSeats)`, but **0 when `totalSeats <= 0`** (no divide-by-zero). availableSeats==totalSeats → 0; availableSeats==0 → 100.
- `hasQualifyingPair`, `bestPairScore`, `bestPairSeatIds` derive from `blocks[0]` (best-first) or null.
- `busiest` = entry with the highest `soldPct`; ties broken by earliest `(date,startTime)`. `null` only when there are no sessions.
- `sessionsScanned` = input length; `sessionsWithPair` = count with non-empty `blocks`.
- `party`, `minScore` echoed from opts.

## Non-negotiables
- Core is PURE: no `Date.now()`/`new Date()` without an argument, no network, no I/O. `today` is injected.
- Do NOT reimplement scoring or adjacency — `blocks` arrive pre-computed via core `findAdjacentBlocks`.
- Do not mutate the input array; sort a copy.
- The CLI (`scripts/lead-time.ts`) must not be imported by tests and must not block the unit suite.

## Test requirements (for the test author — numbered; cover the nasty edges)
1. Empty input → `{ sessionsScanned:0, sessionsWithPair:0, earliest:null, earliestLeadDays:null, busiest:null, timeline:[] }`.
2. Unsorted input → `timeline` sorted ascending by date then startTime (mix dates AND same-date times).
3. `earliest` skips earlier sessions with empty `blocks` and picks the first chronological one WITH blocks.
4. `earliestLeadDays`: today `2026-06-28`, earliest.date `2026-07-01` → `3`; same-day → `0`; past earliest.date → clamped `0`.
5. `soldPct`: total 340 / avail 85 → 75; total 0 → 0; avail==total → 0; avail 0 → 100.
6. `hasQualifyingPair`/`bestPairScore`/`bestPairSeatIds` from `blocks[0]`; all null/false when blocks empty. Use a real `SeatBlock` fixture.
7. `busiest` = max soldPct; with a tie, the earliest chronological wins.
8. `sessionsWithPair` counts only non-empty-`blocks` sessions; `sessionsScanned` = total.
9. `party`/`minScore` echoed; input array not mutated (assert original order preserved on the passed array).
10. Realistic Odyssey-shaped fixture: several early wide-open sessions (high avail, blocks present) + later near-sold opening sessions (low avail, some with empty blocks) → `earliest` is an early session, `busiest` is a near-sold opening session, `earliestLeadDays` sensible.

## Live acceptance (the real gate — not unit)
`scripts/lead-time.ts` run for **The Odyssey (movieId 19797) @ IMAX Sydney (Event cinemaId 96), party 2,
reasonable minScore (~60), horizon ~21 days** must produce a coherent report: an earliest qualifying
session, its lead days, and a timeline showing the early-July previews as open and the Jul 16+ opening
sessions as the busiest. Capture the output as the acceptance evidence.

## Out of scope
- Any API endpoint or web UI (separate work). New `ScreenFormat` kinds. Multi-cinema fan-out (one cinema per run is fine). "Release window" inference — the finder is movie-agnostic; it does not know premiere dates.
