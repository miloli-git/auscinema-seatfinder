# Deploying / self-hosting

A single Docker Compose stack runs the whole thing anywhere Docker runs (a NAS, a VPS, a
laptop): the API, the web UI, and an access gate. Booking is always handed off to the
cinema's own site, so this never handles payment.

## Quick start

```bash
cd deploy
cp .env.example .env
# set BASIC_AUTH_USER and generate BASIC_AUTH_HASH:
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'your-password'
# paste the hash into .env, then:
docker compose up -d --build
```

Open `http://localhost:8080` (or whatever `SITE_ADDRESS` / `WEB_PORT` you set). You will be
prompted for the basic-auth credential, then the seat finder loads.

## How it fits together

- **api** (Fastify): talks to the cinema backends server-side (so the browser never does,
  which sidesteps CORS and bot walls). In-memory session cache + per-IP rate limit.
- **web** (Caddy): serves the static SPA and reverse-proxies the API routes on the same
  origin. The **access gate lives here**, at the proxy layer.
- **watcher** (optional, `--profile alerts`): polls saved queries and webhooks you when a
  seat above your score threshold opens.

## Access gate: basic_auth now, Authentik (or anything) later

The gate is deliberately at the proxy layer, not in the app, so you can swap mechanisms
without touching code. Out of the box it is `basic_auth` (one credential). To move to a
self-hosted IdP like Authentik, replace the `basic_auth` block in `Caddyfile` with a
`forward_auth` block pointing at the Authentik outpost. Nothing else changes.

Prefer not to expose a port at all? Point a Cloudflare Tunnel (or Tailscale) at the `web`
container and leave `SITE_ADDRESS=:8080`.

## Production note

For a single user or a small group this stack is complete. If you grow it into a hosted,
multi-user alerts service, the one piece to replace is the watcher's local JSON state file
(swap for a database), and you would move the stateless `api` container onto a managed
container host. The API is built to make that lift clean.

## Event cinema snapshot refresh (#51)

Event's cinema list only exists in their `/Cinemas` page HTML, so the adapter ships a dated
snapshot. In production a host cron re-captures it weekly into `deploy/refdata/cinemas.au.json`
(gitignored), which is mounted read-only at `/refdata` into `api`, `refresh`, and `ingester`;
`EVENT_CINEMAS_PATH` points the adapter at it. Missing or invalid file = automatic fallback to
the bundled snapshot, so a failed capture can never take `listCinemas` down. Containers read it
at call time; no rebuild or restart needed after a refresh.

Cron line (NAS, weekly; only Docker required — runs the capture in a disposable node container):

```
cd /mnt/raptor/claude-projects/seatfinder && mkdir -p deploy/refdata && \
  docker run --rm -v "$PWD":/app -w /app node:24-alpine \
  npx -y tsx scripts/capture-event-cinemas.ts --out deploy/refdata/cinemas.au.json
```

The script refuses to write if it parses fewer than 45 cinemas (page format change guard,
exit 2). `--compare <path>` diffs a fresh capture against an existing snapshot (exit 3 on
drift) — useful for alert-only runs. Wrap the cron in the standard error-alert webhook so a
capture failure pings Discord.
