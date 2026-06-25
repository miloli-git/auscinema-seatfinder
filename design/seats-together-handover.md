# Seats Together — handover

Last updated **2026-06-25 13:15**. Read with `design/seats-together-design.md`
(§ "ST-4 Web UI — LOCKED SPEC"), the board (https://github.com/users/miloli-git/projects/1),
and epic **#31**. Full build narrative is in `docs/session-log.md`. Self-contained: a fresh
session can resume from this doc.

## Status: SHIPPED + VERIFIED (2026-06-25)
The cached-adjacency **date × cinema matrix** is live at https://seatfinder.miloli.org
("Seats together" mode) and **Gate 3 (Milo browser smoke) PASSED**. ST-1 → ST-4 all done on `main`,
deployed on the NAS. Repo is clean: only `main`, no open branches, working tree clean.

## ⏭ Resume here (next action) — backlog, no blockers
Recommended order:
1. **Movie name-picker** (highest user-value). The movie input is a raw id today (`19796`); `/catalog`
   already returns `{id,name}` — swap the text input for a dropdown. Makes the feature usable without
   knowing ids. Files: `apps/web/src/components/TogetherView.tsx` (the input), `apps/web/src/api.ts`
   (a catalog fetch exists / add one).
2. **#41** Event adapter multi-cinema fan-out. `listSessions` joins `cinemaIds` with a comma into one
   `GetSessions` call; the Event API returns **0** for `15,96` (works per single cinema). Fix = one
   request per cinemaId, merge/dedupe by session id. Unblocks cross-chain-by-title search. Add a 2-cinema
   test. File: `packages/adapters/event/src/index.ts:53`.
3. **#42** ingester seatmap cap (`maxSeatmapsPerWatch=60`, `sweep.ts:24`) skews dense cinemas to early
   dates → far-out matrix columns thin out. Per-date cap / raise / round-robin before slicing.
4. **#30** schedule the ingester as the hourly compose loop (today it's a one-shot `run --rm` behind the
   `ingest` profile). The watch-add half (IMAX/Darling) was already done in ST-0. Pair with #42.

## What shipped (all on `main`, deployed)
- **ST-0 (#35):** `/together`+`/catalog` route through Caddy `@api` + vite `API_ROUTES` (were returning
  the SPA shell). Web image rebuild bakes the Caddyfile (`--build`). Cache refreshed both cinemas.
- **#40 + L2:** vitest harness + `apps/web/src/together/{normalize,filters,matrix}.ts` (Fork-1 normaliser,
  format/time predicates, `buildMatrix`). 26 tests.
- **#39 (L1):** `/together` returns `block:null` for matched-but-sold sessions (powers `sold` vs `—`).
  Red→green verified on a disposable pg. Live: count 120→128, 8 sold sessions surfaced.
- **#29 L3:** matrix components + #36 (`highlightSeatIds`) / #37 / #38, mode toggle, `TogetherView` glue.
  41 tests.
- **#29 L4:** Playwright E2E (chromium) acceptance, route-mock fixture
  (`apps/web/e2e/fixtures/together.fixture.ts`, 3 cell states). 5 tests.
- **Codex SHIP review** caught 3 real `TogetherView` integration bugs (out-of-order response race;
  minScore re-query used edited-not-scanned params; stale matrix on empty id) → all fixed + tested
  (final 44 vitest + 5 Playwright green).
- DoD contract: `docs/ST-4-tdd-plan.md`. Board moved to repo owner `miloli-git/projects/1` (old
  org `miloli-lab/#8` couldn't link cross-org; deleted).

## Locked design facts (don't relitigate)
- **View = date × cinema matrix** for one chosen movie. Cell = best available block at `minScore` in the
  time filter → score / `sold` (sessions exist, no block) / `—` (no session). Inputs: movie (lead,
  required) · party (default 2) · minScore (default 74, adjustable → re-queries) · format multi-select ·
  time-of-day presets (Any / Evenings ≥17:00 / Weekends).
- **Fetch model:** one `/together` call per (movie, party, minScore); format/time/day filtered
  client-side. minScore is the only input that re-queries.
- **Fork 1:** web-side `normalizeTogetherSession()` maps `/together`'s session (`format: string|null`,
  `screen`) into the web `Session` (`format:{kind,raw}`, `screenName`). **Fork 2:** movie-led pickers;
  cinema/date are the matrix scan axes, not gates.
- **TDD invariant:** implementer never edits a test to pass; paired `[red]`/`[green]` commits per layer.

## Gotchas / environment (still relevant for the backlog)
- **NAS:** `claude-code@192.168.1.222` (passwordless sudo + docker). Repo at
  `/mnt/raptor/claude-projects/seatfinder`. Deploy: `cd deploy && sudo docker compose up -d --build
  --force-recreate api web`. Web image bakes the Caddyfile → rebuild on Caddyfile/SPA changes.
- **pg tests:** no local Postgres on Windows. Spin a disposable one on the NAS
  (`sudo docker run -d --name sf-testpg -p 5433:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=sftest
  postgres:16-alpine`), then from Windows `DATABASE_URL=postgres://postgres:test@192.168.1.222:5433/sftest
  node --test packages/api/dist/together.test.js` (the test applies `db/schema.sql`, refuses db named
  `seatfinder`). Tear down after.
- **Codex review:** inline the file contents AND the closed types (`types.ts`); forbid file reads / `rg`;
  `-c model_reasoning_effort=medium`. It starts in `Z:\obsidian-vault`, not the repo. See
  `.claude/memory/reference_codex_review_inline_contracts`.
- **Compose:** Caddy needs `handle` blocks; double `$`→`$$` in `.env`.
- IMAX Sydney = cinemaId **96**, George St = **15** (`packages/adapters/event/data/cinemas.au.json`).
  `watches.json` = two single-cinema watches (table id 3={15}, 4={96}). Demo movie id: **19796**.

## Key paths
- API `/together`+`/catalog`: `packages/api/src/index.ts` (~L510-646). Block core:
  `packages/core/src/blocks.ts`. Web matrix: `apps/web/src/together/{normalize,filters,matrix}.ts` +
  `apps/web/src/components/{Matrix,MatrixCell,TogetherDrillIn,MinScoreControl,TogetherView,SeatMapView}.tsx`.
  Fetch: `apps/web/src/api.ts`. E2E + fixture: `apps/web/e2e/`. Deploy: `deploy/{docker-compose.yml,Caddyfile,watches.json}`.
- Schema: `db/schema.sql`. DoD: `docs/ST-4-tdd-plan.md`. Design: `design/seats-together-design.md`.
  Build log: `docs/session-log.md` (gitignored, local).
