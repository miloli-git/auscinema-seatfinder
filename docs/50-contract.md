# #50 — Large-format labelling + filter (acceptance source of truth)

Tests AND implementation target THIS. Build target: `apps/web/`.
Issue: #50 (auscinema-seatfinder). Branch: `feat/50-large-format-badges`. Base: `main`.

Goal: make large-format sessions (IMAX, V-Max, Gold Class, Xtremescreen, Titan XC, etc.) visible
and **findable** in `apps/web`. Minimum win: a user can see an IMAX badge and filter results to
large-format only.

## Environment / runtime
- TS/React (Vite), workspace `apps/web`. Tests: **vitest** (`npm test -w @auscinema/web` from repo root,
  or `npm test` inside `apps/web`). jsdom + @testing-library available. No network in unit tests.
- Existing helpers in `apps/web/src/format.ts`; existing `formatLabel(f)` already returns
  `f.raw?.trim() || FORMAT_LABEL[f.kind]`. Existing `apps/web/src/components/SessionCard.tsx` already
  renders `<span className="tag">{formatLabel(session.format)}</span>` for EVERY session incl. standard.
- Core type (do NOT change): `ScreenFormat { kind: "standard"|"premium"|"goldclass"|"imax"|"vmax"|"other"; raw: string }`.
- Adapters already preserve `raw` (Hoyts "XTREME"→{other,"XTREME"}, Reading "Titan XC"→{other,"Titan XC"},
  Event "IMAX"→{imax,"IMAX"}). No adapter change expected; a guard test asserts this.

## API / behaviour (new code targets these signatures)

Add to `apps/web/src/format.ts`:

1. `isLargeFormat(f: ScreenFormat): boolean`
   - `true`  for kind ∈ { imax, vmax, goldclass, premium }.
   - `true`  for kind === "other" **with a non-empty `raw`** (e.g. Xtremescreen, Titan XC) — labelled
     non-standard formats are large-format/premium.
   - `false` for kind === "standard".
   - `false` for kind === "other" with **empty/whitespace `raw`** (unknown → treat as standard).

2. `formatBadge(f: ScreenFormat): { label: string; premium: boolean } | null`
   - Returns `null` when the session should show **no** badge: kind === "standard", OR
     (kind === "other" AND `raw` is empty/whitespace).
   - Otherwise `{ label: formatLabel(f), premium: isLargeFormat(f) }`. (premium is always `true` when
     non-null given the rules above, but expose it so the chip can style/aria off it.)
   - `label` must surface the chain's own `raw` when present (so "Xtremescreen"/"Titan XC"/"V-Max"
     show verbatim, not a generic "Other").

## Done-when (per behaviour, checkable)
- `isLargeFormat` returns per the truth table above (incl. the two "other" edges). → unit asserts.
- `formatBadge` returns `null` for standard and empty-unknown; a labelled object otherwise. → unit asserts.
- `SessionCard` renders the format badge **only when `formatBadge(session.format) !== null`**; standard
  sessions render NO format chip. The chip carries a `data-format={kind}` attribute and (when premium)
  a marker the CSS/aria can target (e.g. `data-premium="true"` or class). IMAX session → visible "IMAX"
  badge. → component test (RTL) asserts present for IMAX, absent for standard.
- `App.tsx` exposes a **"Large format only"** toggle (checkbox) in the existing Refine drawer. When ON,
  the visible session list is additionally filtered to `isLargeFormat(session.format) === true`. When
  OFF (default), behaviour is unchanged. → the filter predicate must be a pure, unit-testable function
  (e.g. `largeFormatOnly(sessions, enabled)`), tested directly; App wiring verified by browser smoke.
- Adapter raw-preservation guard: a test importing the built adapters (or fixtures) asserts Hoyts
  "XTREME"→{kind:"other",raw:"XTREME"}, Reading "Titan XC"→raw preserved, Event "IMAX"→{kind:"imax"}.
  (If importing adapters cross-package is awkward in the web vitest config, assert via the helper layer
  using hand-built ScreenFormat fixtures instead — the point is the label/badge survives, not re-test
  the adapter.)

## Non-negotiables
- Do NOT change `packages/core` ScreenFormat or any adapter `mapFormat` logic (they already preserve raw).
- Standard sessions: NO format chip after this change (removing the always-on "Standard" tag is intended).
- Default view (filter OFF) returns the exact same sessions as today — the filter is purely additive.
- Keep all existing tests green. New pure helpers must be unit-tested without React where possible.
- No new runtime deps.

## Test requirements (for the test author — numbered, cover the nasty edges)
1. `isLargeFormat`: true for each of imax, vmax, goldclass, premium (one case each).
2. `isLargeFormat`: true for `{kind:"other", raw:"Xtremescreen"}` and `{kind:"other", raw:"Titan XC"}`.
3. `isLargeFormat`: false for `{kind:"standard", raw:"Standard"}` and `{kind:"standard", raw:""}`.
4. `isLargeFormat`: false for `{kind:"other", raw:""}` and `{kind:"other", raw:"   "}` (empty/whitespace unknown).
5. `formatBadge`: returns null for standard and for empty-unknown "other".
6. `formatBadge`: returns `{label:"IMAX", premium:true}` for `{kind:"imax", raw:"IMAX"}`.
7. `formatBadge`: label surfaces raw verbatim — `{kind:"other", raw:"Xtremescreen"}` → label "Xtremescreen";
   `{kind:"vmax", raw:"V-Max"}` → label "V-Max".
8. Filter predicate `largeFormatOnly(sessions, true)` keeps only large-format; `(sessions, false)` returns
   the input unchanged (same length + order). Use a mixed fixture (1 standard, 1 imax, 1 other-with-raw,
   1 other-empty) → enabled keeps the imax + other-with-raw (2), disabled keeps all 4.
9. `SessionCard` (RTL): an IMAX ranked session renders a badge with text "IMAX"; a standard ranked
   session renders no format chip (query the chip by its class/data-attr and assert absent).
10. Adapter/label guard (per Done-when): raw survives for XTREME / Titan XC / IMAX.

## Out of scope (do NOT build)
- New `ScreenFormat` kinds (e.g. a dedicated "xtremescreen"). Surfacing `raw` is the accepted approach.
- Filtering by specific format (only the binary large-format-only toggle for v1).
- Any change to seat scoring, booking, or adapters' network behaviour.
