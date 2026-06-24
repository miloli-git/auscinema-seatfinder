# @auscinema/web

Seat-finder SPA (Vite + React + TypeScript). Ranks Event Cinemas sessions by the
best available seat for your preferences, then deep-links into the chain's own
booking flow. It does **not** book — booking is the link out.

## Run it locally

1. **Start the API** (`packages/api`) from the repo root:

   ```sh
   npm install
   npm run build -w @auscinema/api
   PORT=3001 node packages/api/dist/index.js
   ```

2. **Point the web app at it.** The dev/preview server proxies the API routes
   (`/cinemas`, `/sessions`, `/seatmap`, `/best`, `/healthz`) to the API, so no
   CORS config is needed on the API. Defaults target `http://localhost:3001`.
   Override only if your API runs elsewhere:

   ```sh
   cp apps/web/.env.example apps/web/.env
   # VITE_DEV_API_TARGET=http://localhost:3001   # where the proxy forwards
   # VITE_API_BASE=                              # empty = same-origin via proxy
   ```

   To skip the proxy and hit a CORS-enabled API directly, set `VITE_API_BASE` to
   its absolute URL.

3. **Start the dev server:**

   ```sh
   npm run dev -w @auscinema/web
   # http://localhost:5173
   ```

For a production build / preview:

```sh
npm run build -w @auscinema/web     # tsc --noEmit + vite build -> apps/web/dist
npm run preview -w @auscinema/web   # serves the build on :4173
```

## Using it

- Enter a **movie ID**, one or more **cinema IDs** (comma-separated; or pick from
  the cinema dropdown which is populated from `GET /cinemas`), and a **date**.
- Tune seat preferences: **target depth** (front→back), **centrality vs depth**
  weighting, **seat classes**, and **avoid paired seats**.
- Submit to call `GET /best`. Sessions render ranked by best-seat score. An
  optional **From/To time window** filters the list client-side.
- Click a session to load `GET /seatmap` and render the auditorium: seats are
  shaded by score (brighter = better), sold seats are dimmed, structural spacers
  are gaps, and the top picks are starred.
- **Book on Event Cinemas** opens the session's `bookingUrl` in a new tab.

Fixture to try: movie `19797`, cinema `58`.

## Config

| Var             | Default                 | Purpose            |
| --------------- | ----------------------- | ------------------ |
| `VITE_API_BASE` | `http://localhost:3001` | Seat-finder API URL |
