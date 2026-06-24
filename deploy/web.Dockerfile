# Web image: builds the static SPA, serves it with Caddy, which also reverse-proxies
# the API routes (same-origin, so no CORS) and applies the access gate.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig*.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci
# Same-origin requests (VITE_API_BASE empty): Caddy proxies the API routes below.
RUN npm run build -w @auscinema/web

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
