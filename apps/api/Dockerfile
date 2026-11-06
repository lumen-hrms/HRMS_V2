# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# HRMS API image — plain long-lived Node server (no serverless adapter).
# Build context is the REPO ROOT (the api package.json carries an unused
# `hrms-platform: file:../..` dep that npm needs to resolve). Deploy with:
#   fly deploy --config apps/api/fly.toml --dockerfile apps/api/Dockerfile
# run from the repo root. See docs/DEPLOY.md.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS build
WORKDIR /app
# OpenSSL is required by Prisma's query engine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Resolve deps first for layer caching. The root package.json (no deps of its
# own) only exists to satisfy the api's `file:../..` link.
COPY package.json ./
COPY apps/api/package.json apps/api/package-lock.json ./apps/api/
WORKDIR /app/apps/api
RUN npm ci --no-audit --no-fund

# App source + Prisma client + Nest build, then drop dev dependencies.
# The type-checking build peaks at ~650 MB, but on the 1 GiB preview box
# Node's default heap cap is ~450 MB (it sizes from physical RAM), so the
# build OOMs even though the box has 2 GiB of swap. Raise the cap for this
# step only; the runtime stage keeps Node's default.
COPY apps/api/ ./
RUN npx prisma generate \
  && NODE_OPTIONS=--max-old-space-size=1536 npm run build \
  && npm prune --omit=dev

# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/apps/api
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/apps/api/package.json ./package.json
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist

# Migrations are NOT run here — the schema owner applies them to Supabase
# deliberately (see docs/DEPLOY.md). This image only ships code.
EXPOSE 3000
CMD ["node", "dist/main.js"]
