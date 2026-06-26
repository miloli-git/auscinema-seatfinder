# auscinema-seatfinder

Find a cinema seat **you'd actually want to sit in** — not just any free seat — across major
Australian cinema chains (Event, Hoyts, Reading, Village), then book on the cinema's own page.

Most cinema sites tell you a seat is *available*. None tell you whether it's a *good* seat. This
tool scores every available seat by geometry (how central in the row, how far back) and by seat
class (recliner / Gold Class / Vmax / standard), then ranks. Booking itself is always handed back
to the official cinema page — this project never touches payment.

> **Personal / educational project.** It reads the cinemas' own public web endpoints at a low
> request rate, uses no authentication, and stores no personal data. It is not affiliated with or
> endorsed by any cinema chain.

Live: **https://seatfinder.miloli.org**

## Two modes

1. **Live seat-quality (shipped).** Enter a movie + cinema(s) + date + seat preferences. The API
   fetches the session list and live seat maps server-side, scores every available seat, and ranks
   sessions by their best available seat. Click through to a live, score-shaded seat map, then book
   on the chain's page.

2. **Seats Together — cached cross-cinema discovery (in progress, epic #31).** For a movie, find
   sessions with **N adjacent seats in the optimal zone**, swept across cinemas and a date range.
   A live sweep would be hundreds of seat-map fetches per query, so a scheduled **ingester**
   precomputes scored seats into Postgres and the API serves `/together` / `/catalog` from cache,
   re-verifying the live seat map only the moment a result is opened. ST-1 (core adjacency) and
   ST-2 (DB + ingester) are shipped; the API + web surface are in progress. See
   [`design/seats-together-design.md`](design/seats-together-design.md) and
   [`docs/seats-together-handover.md`](docs/seats-together-handover.md).

## Monorepo map

npm workspaces, Node 20+, ESM + TypeScript throughout. See
[`docs/architecture.md`](docs/architecture.md) for data flow across both modes.

| Package | Name | What it is |
|---------|------|-----------|
| `packages/core` | `@auscinema/core` | Chain-agnostic domain types, the `ChainAdapter` interface, the seat scorer (`scoreAvailableSeats` / `rankSeats`), the adjacency search (`findAdjacentBlocks`), and the shared `UpstreamError`. |
| `packages/adapters/event` | `@auscinema/adapter-event` | Event Cinemas adapter (reference impl; true geometry, bundled cinema list). |
| `packages/adapters/hoyts` | `@auscinema/adapter-hoyts` | Hoyts adapter (Azure APIM JSON; index-order geometry — adjacency approximate). |
| `packages/adapters/reading` | `@auscinema/adapter-reading` | Reading adapter (Vista behind an AWS API-Gateway facade; bootstrap bearer token). |
| `packages/adapters/village` | `@auscinema/adapter-village` | Village adapter (Vista via Next.js route handlers + Algolia session index). |
| `packages/api` | `@auscinema/api` | Fastify service: normalises adapters, in-memory session cache, per-IP rate limit, serves the live `/seatmap` + (cached) `/together` / `/catalog`. |
| `packages/ingester` | `@auscinema/ingester` | Scheduled sweep worker for Seats Together: reads `watches`, reuses the adapters, scores seats, upserts into Postgres. |
| `packages/watcher` | `@auscinema/watcher` | Optional alert worker: polls saved queries and webhooks you when a seat above your score threshold opens. |
| `apps/web` | `@auscinema/web` | Vite + React SPA. |

Every adapter implements one interface (`listCinemas`, `listSessions`, `getSeatMap`). Scoring, the
API and both workers depend only on that interface, never on a chain's raw payloads.

## Quick start

```bash
npm install          # npm workspaces, Node 20+
npm run build        # build --workspaces --if-present (tsc -b per package)
npm test             # test --workspaces --if-present (node --test, offline fixtures)
npm run typecheck    # tsc -b across the repo
npm run smoke        # optional: live end-to-end check across all four chains (not CI)
```

`npm run smoke` builds then runs `scripts/smoke.ts` against the **real** chain backends for the
current date (`listCinemas → listSessions → getSeatMap → rankSeats` per chain). Each chain runs
independently; exit code is non-zero if any chain fails.

## Dev workflow

- **Web SPA:** `npm run dev -w @auscinema/web` (Vite on `:5173`). The dev server proxies the API
  routes to a local API. See [`apps/web/README.md`](apps/web/README.md) for running the API
  alongside it and the env vars.
- **Per-package work:** each package has `build` and `test` scripts; run them scoped, e.g.
  `npm test -w @auscinema/adapter-event` or `npm run build -w @auscinema/core`.
- **Ingester (Seats Together):** needs a Postgres `DATABASE_URL`.
  `npm run seed -w @auscinema/ingester` then `npm run ingest:once -w @auscinema/ingester`.
- **Watcher (alerts):** `npm run check -w @auscinema/watcher` (single shot) or
  `npm run watch -w @auscinema/watcher` (loop).
- The reverse-engineered chain request/response shapes are documented in
  [`docs/endpoints.md`](docs/endpoints.md); the scoring model in [`docs/scoring.md`](docs/scoring.md).

## Deploy / self-host

A single Docker Compose stack (API + web + Postgres, optional ingester / watcher) runs anywhere
Docker runs. The web container serves the SPA and reverse-proxies the API on the same origin;
Postgres is internal-only. Full instructions, env vars, and the access-gate options live in
[`deploy/README.md`](deploy/README.md). Production runs on the NAS behind a tunnel with only the
web port public.

## Licence

MIT — see [LICENSE](LICENSE).
