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
