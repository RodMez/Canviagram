# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22.17.0
FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app

# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends tini curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && npm ci \
    && mkdir -p node_modules/bindings node_modules/file-uri-to-path

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV SESSION_SECRET=dummy_secret_32_chars_long_xxxxxxxxxxxxxxxxxxxxxxxx
ENV DATABASE_URL=file:/tmp/build.db
ENV AI_API_KEY=dummy_ai_key_for_build
ENV AI_BASE_URL=https://openrouter.ai/api/v1
ENV AI_MODEL=anthropic/claude-3.5-sonnet
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=/data/canviagram.db
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV AI_BASE_URL=https://openrouter.ai/api/v1
ENV AI_MODEL=anthropic/claude-3.5-sonnet

RUN mkdir -p /data && chown nextjs:nodejs /data

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/bindings ./node_modules/bindings
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
COPY --from=builder --chown=nextjs:nodejs /app/lib/db/migrations ./lib/db/migrations
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs

VOLUME /data
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["tini", "--", "./docker-entrypoint.sh"]
CMD ["node", "server.js"]
