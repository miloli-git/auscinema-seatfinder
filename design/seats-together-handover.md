# Seats Together — handover (resume in a new session)

Last updated **2026-06-25 10:07**. Read this with `design/seats-together-design.md`
(§ "ST-4 Web UI — LOCKED SPEC"), the board (https://github.com/users/miloli-git/projects/1),
and epic **#31**. This doc is self-contained: a fresh session can resume from it.

## ⏭ Resume here (next action)
**ST-0 (#35)** — inline infra, NOT TDD. Wire `/together`+`/catalog` through Caddy + the vite proxy,
redeploy on the NAS, run the ingester `--once` to refresh the cache, then **verify JSON through the
public tunnel**. After that: write `docs/ST-4-tdd-plan.md` as a Definition-of-Done contract, then run
#40 → #39 → #29 **test-first** via `/dual-harness` with human gates.

## Where we are (2026-06-25)
- **ST-1/2/3 DONE on `main`** (core `findAdjacentBlocks` / db+ingester / api `/together`+`/catalog`).
  App live at https://seatfinder.miloli.org (no auth; Fastify rate-limit still guards upstreams).
  NAS deploy `/mnt/raptor/claude-projects/seatfinder`, web port 9015, `db` service internal-only.
- **This session = a full pre-build dependency + design pass for ST-4.** No code written. Output =
  locked decisions + new issues + board #8 + the design spec. Nothing is half-built.

## Decisions locked this session (don't relitigate)
1. **ST-4 view = date × cinema matrix** (NOT a ranked list). Driven by the real use case: *"The Odyssey
   at IMAX, ~3 weeks out, sold out near-term — scan dates AND cinemas at once, filtered by format +
   time-of-day, around weekday work."* Full spec: design doc § "ST-4 Web UI — LOCKED SPEC".
   - **Cell** = best available block at current `minScore` among that (cinema,date)'s sessions **in the
     time filter** → show score / `sold` (sessions exist, no block) / `—` (no session).
   - **Inputs:** movie (lead, required) · party (default 2) · `minScore` (default 74, **adjustable** →
     re-queries) · **format** multi-select · **time-of-day + day** presets (Any / Evenings ≥17:00 / Weekends).
   - **Drill-in:** click cell → that cell's sessions → live `/seatmap` confirm with the block highlighted.
   - **Fetch model:** one `/together` call per (movie, party, minScore); format/time/day filtered
     **client-side** (cache is small; no per-cell calls). **Mobile:** sticky cinema column + scroll dates.
2. **Fork 1 (session shape) = client-side normaliser.** `/together`'s session has `format: string|null`,
   nullable `startTime`, `screen` (not `screenName`) — diverges from the web's `Session` type. A web-side
   `normalizeTogetherSession()` maps it in; preserve cinema + time + "as of" (the fields ranked-on here).
3. **Fork 2 (pickers) = movie-led, broad.** Cinema/date are the matrix scan axes, not required gates.
4. **Smoke = hybrid.** Unattended loop smokes against a **LOCAL seeded pg** (deterministic fixture with a
   great-block cell, a `sold` cell, an empty gap). **ONE live-NAS browser smoke** is the post-deploy gate
   (Milo's, per CLAUDE.md "curl ≠ browser"). This overrides the earlier "point at NAS" pick.
5. **ST-4 runs test-first (TDD).** RED → GREEN → REVIEW per layer. Tests authored from the frozen spec and
   **Codex-reviewed before implementation**. Invariant: **the implementer never edits a test to pass.**
   Paired `[red]` then `[green]` commits per layer = the visible proof (public repo / portfolio artifact).
6. **Test-author split:** Claude authors the failing tests (reliable file writes), **Codex reviews the
   tests pre-impl + reviews the impl**. Chosen because Codex's file-WRITING choked 3× this session; its
   reasoning/review is solid once contracts are inlined (see Gotchas).

## Issues + board (project #1, owner miloli-git — the repo owner)
https://github.com/users/miloli-git/projects/1
(Was org board miloli-lab/#8; recreated under the repo owner `miloli-git` and linked to the
repo so it shows on the repo Projects tab — public repos track at the repo owner, not the
private lab org. Old #8 deleted 06-25.)
| # | What | Mode | Status |
|---|------|------|--------|
| #35 | ST-0 infra: routes through Caddy+vite, redeploy, refresh cache | inline | **NEXT** |
| #40 | ST-4.0 web test harness (vitest/testing-library/playwright) + seed fixture + write tdd-plan doc | enabler | Todo |
| #39 | ST-3.1 `/together` exposes no-block sessions (powers `sold` cell) | TDD L1 | Todo |
| #29 | ST-4 matrix UI (absorbs #36/#37/#38) | TDD L2→L3→L4 | Todo |
| #36 | highlightSeatIds prop · #37 default-scoring confirm · #38 block-gone state | within #29 | Todo |
| #30 | ST-5 schedule ingester + **add IMAX/Darling watch** | inline | Todo |
| #31 | EPIC | — | tracking |

## Holistic order + gates
`#35 (verify tunnel JSON) → #40 → {#39 L1, #29 L2} → #29 L3 → #29 L4 (Playwright = acceptance) →
Codex SHIP → auto-deploy + Milo's browser smoke → #30`
- **TDD layers inside #29:** L2 pure logic (normaliser, format predicate, time/day predicate,
  `buildMatrix()→cells`) → L3 components (#36/#37/#38, cell render, drill-in) → L4 Playwright E2E.
- **Pipelining:** #39 (L1) ∥ #29-L2 once #40 lands. Hard chain = L2→L3→L4.
- **Human gates (do NOT autonomise across these):** ST-0 tunnel verify · Codex SHIP · Milo's browser smoke.
- **Parked decision:** pulling the "add IMAX/Darling watch" half of #30 forward (a `watches.json` entry +
  one ingest) so the matrix shows real cross-cinema data the day ST-4 ships. Currently left at #30.

## Why-this-matters facts (verified — don't re-derive)
- `/catalog` + `/together` return the **SPA shell** through the deployed Caddy (verified 06-25 via the
  public tunnel: `/healthz`→JSON, `/catalog`+`/together`→HTML). Never worked through Caddy; the ST-3
  "200s on NAS" were container-internal. Caddyfile `@api` AND `apps/web/vite.config.ts` `API_ROUTES` both
  omit the two routes. → ST-0 fixes both.
- Cache = one-shot ingest 06-24, **Event/George St only**, now past-dated. → ST-0 runs ingester `--once`.
- `/together` currently **drops** sessions with no block → web can't tell `sold` from `—` → #39.
- `apps/web` has **zero** test tooling (every other package has co-located `*.test.ts`) → #40.
- **IMAX Sydney = Darling Harbour**, a DIFFERENT venue than the sole George St watch (which is V-Max).
  Milo's literal Odyssey-at-IMAX case needs that watch added (#30).

## Execution protocol for ST-4
- **`docs/ST-4-tdd-plan.md` (TO WRITE, first thing in the ST-4 phase)** = the Definition-of-Done contract:
  every acceptance criterion → a named test; layers L1 api-contract(pg) / L2 pure logic / L3 components /
  L4 Playwright E2E; the RED→GREEN→REVIEW invariants; per-gate exit conditions. Write it as a
  **loop-runnable contract** (explicit "done" condition) so a `/dual-harness` run converges. It is NOT a
  GitHub issue — it's a repo doc beside `ST-2-ingester-contract.md` / `ST-3-api-contract.md` /
  `codex-review-loop.md`.
- Drive #39 + #29 layer-by-layer via `/dual-harness`, surfacing to Milo at each gate. No autonomous ralph
  across the whole epic; no separate `/goal` artifact (the DoD contract is the target).

## Gotchas / environment
- **Codex (`codex exec --skip-git-repo-check`)**: its file-reading is slow and it walked the entire vault
  via `rg --files` (dumped node_modules), burning 3 runs. `--cd`/workdir was **not honored** — it starts
  in `Z:\obsidian-vault`. **FIX: inline the file contents/contracts into the prompt; tell it NOT to read
  files or run `rg --files`; ask for the synthesis only.** Its reasoning/review is good. Use
  `-c model_reasoning_effort=medium` for review. See `.claude/memory/reference_codex_review_inline_contracts`.
- **Compose deploy footguns:** Caddy needs `handle` blocks; double every `$`→`$$` in `.env`
  (`.claude/memory/reference_compose_caddy_deploy_footguns`).
- **NAS deploy:** `/mnt/raptor/claude-projects/seatfinder`, `docker compose up -d --force-recreate`.
- **pg tests:** no local Postgres on Windows → NAS docker test-runner
  (`.claude/memory/reference_nas_docker_test_runner`); disposable-pg pattern already in
  `packages/api/src/together.test.ts`.

## Key paths
- API `/together`+`/catalog`: `packages/api/src/index.ts` (~L206-646). Block core:
  `packages/core/src/blocks.ts` (`SeatBlock`). Web: `apps/web/src/{App,api,types}.tsx/.ts` +
  `components/SeatMapView.tsx`. Proxy: `apps/web/vite.config.ts`. Deploy: `deploy/{docker-compose.yml,Caddyfile}`.
- Schema: `db/schema.sql`. Watch seed: `deploy/watches.json`. Design: `design/seats-together-design.md`.
- Local build log: `docs/session-log.md`.
