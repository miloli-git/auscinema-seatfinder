# Design — "Seats Together" (cached adjacency discovery)

Status: proposed, awaiting build go. 2026-06-24.

## Problem
Corollary to the live tool: for a movie, find sessions that have **N adjacent seats in the optimal
zone** (score >= a min), swept **across cinemas and a date range**. A live sweep is 100s-1000s of
seat-map fetches per query (too expensive / rate-limited), so we precompute on a schedule into a DB
and serve queries from cache.

## Confirmed decisions
- **Zone** = seat score >= tunable `minScore` (reuse the existing scorer). Default "great" (74).
- **Qualifying** = N contiguous seats in one row, all in-zone, unbroken by aisle/spacer/sold.
  N = party size, default 2. (Hoyts geometry is index-order -> adjacency approximate there; labelled.)
- **Architecture** = scheduled ingester -> Postgres -> DB-backed query ("scoped on load").
- **Cache depth** = sessions + precomputed blocks (store the scored available seats per session, so
  party N / minScore Q stay tunable at query time without re-fetching).
- **Sweep** = config-driven **watchlist** (only registered watches are swept). Cheapest + targeted.
- **Freshness** = hybrid. DB tells you *where to look*; we re-verify the **live** seat map the moment
  a session is opened (the existing hero `/seatmap` call) before booking handoff. Results show
  "as of HH:MM".

## Architecture
```
watches.json ──seed──▶ Postgres.watches
                          │
   ┌──────────────────────┴───────────────────────┐
   │  Ingester (scheduled worker, compose service) │
   │  per enabled watch:                           │
   │   listSessions(movieId?|all, cinemaIds, date) │  reuses the 4 adapters
   │   for each session: getSeatMap -> score       │  per-session isolation + backoff
   │   upsert session + its scored available seats │  (watcher lessons)
   └──────────────────────┬───────────────────────┘
                          ▼
                       Postgres
        watches · sessions · session_seats · ingest_runs
                          │
            ┌─────────────┴──────────────┐
            │  API (Fastify, DB-backed)  │
            │  GET /together  (no upstream)         scoped: chain/movie/cinemas/dates/party/minScore
            │  GET /catalog   (distinct movies/cinemas/dates available)
            │  GET /seatmap   (LIVE, unchanged — the on-open confirm)
            └─────────────┬──────────────┘
                          ▼
                Web: "Seats Together" mode
   pickers from /catalog -> instant ranked /together -> open a result ->
   live /seatmap confirm with the adjacent block highlighted -> book on the chain
```

### Schema (Postgres)
- `watches(id, chain, cinema_ids[], date_from, date_to, movie_id?, party, min_score, scoring jsonb,
  enabled, created_at)` — seeded from `watches.json`, addable later.
- `sessions(id pk, watch_id, chain, movie_id, movie_name, cinema_id, cinema_name, date, start_time,
  format, screen, seats_available, booking_url, seat_allocation, fetched_at, last_seen)`.
- `session_seats(session_id, seat_id, row_label, row, col, area_kind, score)` — **available** seats
  only (a column gap = sold/aisle = an adjacency break, so sold rows need not be stored). This is the
  compact "blocks" material that keeps (N, Q) tunable at query time.
- `ingest_runs(id, started_at, finished_at, watches, sessions_upserted, seatmaps_fetched, errors)`.

### Core
`findAdjacentBlocks(seats, { minScore, size })` — pure, walks each row by ascending col, breaks runs
on col-gap or score < minScore, returns the best N-window per row `[{row, seatIds, avgScore, minSeat}]`.
Shared by the ingester (precompute) and `/together` (query-time over `session_seats`). Tested in core.

### Query (`/together`)
Filter `sessions` by chain/movie/cinemas/date-range; join `session_seats`; compute blocks for the
requested (party, minScore); rank by best block avg, then earliest start; return block + `fetched_at`.
Pure DB + cheap compute, no upstream.

## Infra
**Own Postgres instance** in the seatfinder compose stack (decided — not shared with PriceWatch; keeps
`deploy/` "copy + compose up" portable, no cross-stack coupling; the DB is a rebuildable cache so
durability needs are low). Added to `deploy/docker-compose.yml`:
- `db` (`postgres:16-alpine`): `POSTGRES_DB/USER/PASSWORD` from `.env`; named volume `pgdata` on the
  raptor pool; **internal compose network only — not published, not tunneled.**
- `ingester` worker (same image as `api`): `DATABASE_URL=postgres://seatfinder:…@db:5432/seatfinder`;
  watcher-style `watch` loop (or NAS cron), cadence per-watch (default hourly).
- `api` gains the same `DATABASE_URL` + `depends_on: [db]`.

Deploys on the NAS behind the existing tunnel; only `web` (9015) stays public.

## Phasing (tests at each step)
1. **Core** — `findAdjacentBlocks` + unit tests (true-geometry + index-geometry + aisle-break cases).
2. **DB + ingester** — schema/migrations, `watches.json`, the sweep worker (reuse adapters, per-session
   isolation, fetch caps), one manual run; verify rows + `ingest_runs`.
3. **API** — `/together` + `/catalog` over the DB; tests against a seeded DB.
4. **Web** — "Seats Together" mode: catalog pickers, instant results, open -> live `/seatmap` confirm
   with the block highlighted, "as of" stamp.
5. **Deploy** — Postgres + ingester in compose on NAS, schedule, live verify (browser smoke).

## Decisions (locked)
- **DB: own Postgres instance** in the seatfinder stack (not shared) — see Infra.
- Watchlist source: `watches.json` seeded into the DB (no management UI in v1).
- Ingester cadence: hourly per watch; sessions list refreshed each run, seat maps re-scored each run.
- Single chain per watch (movieId is chain-bound; cross-chain by title is out of scope v1).
- `/together` is a NEW endpoint; the existing live tool is unchanged (this is additive).

## ST-4 Web UI — LOCKED SPEC (2026-06-25, matrix model)

Supersedes the "ranked list" sketch in Phasing step 4. Driven by the real use case.

**Use case (Milo):** "The Odyssey at IMAX, ~3 weeks out, sold out with good seats near-term.
Scan forward for a date+session that works AND sideways to alternative cinemas, and decide both
at once — around weekday work, coordinatable with friends."

**View = date × cinema matrix.** Rows = cinemas, columns = dates, for one chosen movie.
- **Inputs:** movie (required, lead pick), party (default 2), `minScore` (default 74 "great",
  **adjustable** → re-queries `/together`), **format** filter (multi-select from the cache's formats,
  e.g. IMAX / V-Max / Standard), **time-of-day + day** filter (presets: Any / Evenings ≥17:00 / Weekends).
- **Cell** = best available block at current `minScore` among that (cinema, date)'s sessions **within
  the time filter**: block exists → avg score, colour-banded; sessions exist but none has an available
  block → `sold`; no session in window → `—`.
- **Drill-in:** click a cell → that cell's qualifying sessions (time · format · block row+avg ·
  "as of HH:MM") → pick one → live `/seatmap` confirm with the block highlighted (#36 / #37 / #38).
- **Mobile:** sticky cinema column + horizontal-scroll date columns; confirm = bottom sheet.
- **Fetch model:** one `/together` call per (movie, party, minScore); **format/time/day filtered
  client-side** over the result (cache is small; no per-cell calls).
- **Session-shape seam (Fork 1):** a client-side normaliser maps `/together`'s session (format string,
  nullable `startTime`, `screen`) into the web `Session` shape; preserves cinema + time + "as of".
- **Pickers (Fork 2):** movie-led, broad by default; cinema/date are scan axes (the matrix itself),
  not required input gates.
- **Best-seat mode** unchanged, beside it (mode toggle in the topbar).

**NEW pre-UI API dependency:** the `sold` vs `—` distinction needs `/together` to ALSO expose
sessions that matched the movie but have no block (current `/together` drops them). Small ST-3-area
change → its own issue, sequenced **after ST-0 (#35), before ST-4 (#29)**.

**Smoke/test = hybrid:** unattended dual-harness smokes against a **local seeded pg** with deterministic
fixtures (catalog / together / seatmap incl. a sold-out cell); **one live-NAS browser smoke** as the
post-deploy final gate after ST-0 refresh. (Overrides the earlier "point at NAS" choice, per Codex review.)

## Future (captured, NOT v1)
- **Cross-chain search by movie title** — sweep cinemas across Event + Hoyts + Reading + Village for one
  title (today `/together` is single-chain; cross-chain matching by title is the expansion). Milo flagged
  this as a wanted next step (2026-06-25).
- Server-side `format` / time filters on `/together` (v1 does these client-side).
- Progressive picker narrowing once watch count grows.
