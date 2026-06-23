# auscinema-seatfinder

Find a cinema seat **you'd actually want to sit in** — not just any free seat — across major
Australian cinema chains, then book on the cinema's own page.

Most cinema sites tell you a seat is *available*. None tell you whether it's a *good* seat. This
tool scores every available seat by geometry (how central in the row, how far back) and by seat
class (recliner / Gold Class / Vmax / standard), ranks sessions by their best available seat, and
can alert you when a seat worth taking opens up. Booking itself is always handed back to the
official cinema page — this project never touches payment.

> **Personal / educational project.** It reads the cinemas' own public web endpoints at a low
> request rate, uses no authentication, and stores no personal data. It is not affiliated with or
> endorsed by any cinema chain.

## Status

Early. Event Cinemas adapter first; other chains follow behind a common adapter interface.

| Chain   | Platform                          | Adapter status |
|---------|-----------------------------------|----------------|
| Event   | Vista-style JSON endpoints        | in progress    |
| Hoyts   | Own JSON API (`api.hoyts.com.au`) | planned        |
| Reading | SPA, API host TBD                 | planned        |
| Village | Vista-ish, Cloudflare-gated       | planned        |

## Architecture

```
packages/
  core/              chain-agnostic types + seat-scoring + the ChainAdapter interface
  adapters/
    event/           Event Cinemas adapter (reference implementation)
    hoyts/  reading/  village/   one adapter per chain, same interface
  api/               Fastify service: normalises adapters, caches sessions, fetches seat maps
apps/
  web/               UI: enter movie/cinema/time/prefs -> ranked sessions + live seat map
```

Every adapter implements one interface (`listCinemas`, `listSessions`, `getSeatMap`). Scoring and UI
are written once and serve all chains.

### Polling discipline

Seat availability is live data. Where a chain offers a more-cached "preview" availability feed
(Vista's `?preview=true`), the watcher uses it for polling and only hits live availability at the
moment a seat is surfaced or booked. Be a good citizen: low rate, backoff on errors.

## Endpoint notes

See [`docs/endpoints.md`](docs/endpoints.md) for the reverse-engineered request/response shapes per
chain.

## Develop

```bash
npm install          # npm workspaces, Node 20+
npm run build
npm test
```

## Licence

MIT — see [LICENSE](LICENSE).
