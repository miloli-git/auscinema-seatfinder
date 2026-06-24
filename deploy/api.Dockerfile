# API image: builds the whole workspace, runs the Fastify service.
# Also used (with an overridden command) for the optional watcher service.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig*.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
# Workspace symlinks under node_modules/@auscinema/* point into packages/, so copy both.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/packages ./packages
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/healthz || exit 1
CMD ["node", "packages/api/dist/index.js"]
