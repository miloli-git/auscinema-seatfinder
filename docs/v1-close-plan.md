# v1 Close Plan — per-slice spec + design

Decisions locked 2026-07-02 (GH #47/#54 comments): Stage 9/10 cut, fit-tier = Together-only for the date module, single-party date endpoint. Gate: canonical Odyssey acceptance test passes ON THE PAGE (#54).

---

## Slice 0 — Ops closeout (config only)

**Goal:** alerting armed, repo clean.

**Spec**
- `REFRESH_DEAD_MAN_WEBHOOK` and `WATCHER_WEBHOOK` set in NAS `deploy/.env`, pointing at the ops Discord webhook. Restart the stack.
- Verify by test-firing: temporarily drop `REFRESH_DEAD_MAN_THRESHOLD_MS` (or stop `refresh` for >2h) and confirm a Discord message lands. Restore.
- Local repo: `git pull` (behind origin by 1). Triage uncommitted edits (core/blocks, scoring, ingester cli, watcher, web tests) — commit, branch, or discard each. Decide `eslint.config.js` (commit with CI in slice 1) and `design/research/` (commit or ignore).

**Design notes**
- Discord webhooks 403 on default library User-Agents — confirm `notifier.ts` / deadman poster sets a browser-ish UA before assuming delivery works.
- Acceptance: one real Discord alert received; `main` == `origin/main`, clean tree.

---

## Slice 1 — #51 Event snapshot refresh + CI

**Goal:** kill the dated `cinemas.au.json`; tests run on every PR.

**Spec (#51)**
- `scripts/capture-event-cinemas.ts`: fetch `/Cinemas` HTML (browser UA), parse `cinema-select_{id}_checkbox` + data-name/url/lat/long, emit snapshot JSON with `capturedAt`.
- Guardrail: fail (non-zero, alert) if parsed count < 45 or required fields missing — protects against silent HTML format change.
- Runtime override: adapter loads `EVENT_CINEMAS_PATH` if set and valid, else the bundled snapshot. `listCinemas` stays offline/deterministic.
- NAS: weekly cron runs capture into the compose config volume; on diff vs current, Discord notification (informational). Capture failure alerts via the standard error webhook.

**Spec (CI)**
- `.github/workflows/ci.yml`: on PR + push to main — `npm ci`, typecheck, lint, `npm test`. Node LTS, npm cache.
- Precondition: suite green locally after slice 0 triage (date-sensitive fixtures are the known risk class).

**Acceptance:** capture script produces a valid snapshot against live Event HTML; a PR shows the CI check; cron entry live on NAS (canonical cron file).

---

## Slice 2 — #53 deep-link verification + #52 Hoyts confidence flag

**Spec (#53)** — manual, evidence-logged
- For each chain (Event incl. IMAX Sydney/96, Hoyts, Reading, Village): pick a live session in the app, click Book, confirm the official page lands on the correct cinema + session (not just the chain homepage). Desktop + one mobile check.
- Record matrix in `docs/53-verification.md` (date, sessionId, URL, result). Fix any `bookingUrl` construction bugs found; re-verify.

**Spec (#52)**
- Core: add `geometryConfidence: 'exact' | 'approximate'` to the seatmap type. Hoyts adapter returns `approximate`; Event/Reading/Village return `exact`.
- API: passthrough on `/seatmap`.
- Web: when `approximate`, a small chip on the seat map ("Seat positions approximate") with a one-line tooltip (Hoyts doesn't publish row/col coordinates; positions are inferred from order).

**Acceptance:** all 4 chains verified in the matrix; Hoyts seat map shows the chip, others don't; tests updated.

---

## Slice 3 — 47a: movie-first entry + lens list (grayscale)

**Goal:** flip the app entry to movie-forward. Grayscale only — structure, not styling.

**Spec**
- **Screen 0:** movie list from `/catalog` (cached titles). Text search narrows; the list itself is the "what's on" browse door (movie-first primary + browse co-equal, one surface in v1). Titles are per-chain — duplicates across chains are acceptable (#61 is next-phase); group visually by normalised title string where trivially equal, otherwise show both.
- **Context bar:** assumed defaults (party 2, minScore = current default), skip-to-results. Visible **"Plan group"** mode toggle → per-day steppers (existing `/together` day-varying support). No RSVP layer.
- **Option list:** for the selected movie, options = (cinema, session) candidates from cache with lens chips:
  - *Best seats* — max available block quality (cached scored seats)
  - *Best screen* — format rank via `format.ts` (IMAX > Vmax/Xtremescreen > standard)
  - *Soonest good* — earliest session with a qualifying block for party/minScore (NOT merely next screening; copy explains the condition)
  - *Most together* — Together / Nearby / Split fit tier from existing group-fit logic, together-count ranked, Hoyts lower-confidence
- Honest states on cards: freshness ("as of Xh ago"), stale, not-cached. No-good-seats state per C1 wireframe.
- **API:** add `GET /options?movieKey&party&minScore` (cache-only: sessions + best block + format + fit tier + freshness). Extend `/catalog` if the movie list needs richer fields. Rate-limited like the rest.
- Old two-tab UI (`together`/`best`) retires once parity confirmed; keep `/best` API route (still used by seat-map view).

**Design notes**
- Wireframe source of truth: `design/journey/04-wireframes-c1-c2` — C1 Tradeoff Chooser is the spine; C2's "one hero pick + other ways" informs the default sort.
- Mobile-first, existing `tokens.css` spacing, no direction-G styling yet.

**Acceptance:** enter via movie → ranked options with working lens chips → tap through to seat map. Organiser mode reachable and functional. Browser smoke, 0 console errors.

---

## Slice 4 — 47b: option detail + date-availability module

**Goal:** the date dimension on the page. Cache-only, honest.

**Spec**
- **Option detail:** existing seat-map hero (heatmap, Together drill-in, booking CTA) reached from option cards. No rebuild, wiring only.
- **API:** `GET /availability?movieKey&party&minScore[&cinemaId|chain]` → per cached date:
  `{ date, state, leadDays, bestBlockScore?, soldHeldPct?, asOf }`
  States (exhaustive): `good-block` | `no-qualifying-block` | `sold-held-now` | `stale` | `not-cached` (beyond horizon or not yet ingested — distinguish in copy via `/catalog` horizonDate/maxCachedDate).
- **Engine:** port `buildLeadTimeReport` semantics to read from Postgres (`session_seats` + adjacency via `blocks.ts`) instead of live adapter calls. Single `party` size. Together-only: the module answers "earliest date with one adjacent block of N"; Nearby/Split are NOT computed here.
- **UI:** compact date strip in option detail + movie header summary: "Earliest 2 good seats: Tue 16 Jul (14 days out) · 81% sold/held as of 2h ago". Copy discipline: "sold/held now", "as of", never forecast language. Restrained timeline per the #47 comment (snapshot, not prediction).
- No live forward scan from the page. Ever (v1).

**Acceptance:** Odyssey answerable end-to-end on localhost (gate rehearsal): earliest qualifying pair, lead days, sold/held snapshot, all from cache. All 5 states reachable in tests.

---

## Slice 5 — 47c: Codex pass + direction G visuals

**Spec**
- **Codex heuristic review** of the built grayscale flows (fresh-context skeptic): solo task ("find the option you'd book Saturday night") + unaided organiser-discoverability task. Fix BLOCKERs and IMPORTANTs before styling; log the review artifact in `reviews/`.
- **Visual pass:** apply direction G (Glossier x SOH hybrid) — type scale, palette, cinematic glow heatmap, class-driven seat widths — from `design/iterations/mocks/g-*` + extractions. Structural changes forbidden in this slice; per-seat scores come from the live scorer (fixes the recompute-at-render issue in the G mock).
- Mobile overflow + `:focus-visible` regressions checked (prior fixes must survive).

**Acceptance:** browser smoke desktop + mobile, 0 console errors; heatmap reads at a glance; Codex review artifact committed.

---

## Slice 6 — Acceptance + close

**Spec**
- On **seatfinder.miloli.org** (not localhost): "find me 2 good seats at IMAX for The Odyssey, and how far ahead do I need to look?" → coherent answer on the page (earliest qualifying 2-seat block, lead days, sold/held). Cross-check against `scripts/lead-time.ts` CLI output for consistency.
- Redeploy: NAS pull, `docker compose up -d --build --force-recreate` (footguns: `$$` bcrypt escaping, Caddyfile `handle` blocks).
- Close #47, #46 (P30.3 complete once the alert is armed and freshness surfaced), #51, #52, #53, then EPIC #54. Confirm out-of-v1 list carries to next phase: #48, #61, Authentik.

**Acceptance:** EPIC #54 checklist fully ticked; canonical test passes on the live page; CLI-only does not count.
