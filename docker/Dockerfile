# syntax=docker/dockerfile:1.7
FROM node:26-slim AS build
ENV CI=true
# node:26-slim ships no corepack: pnpm is installed at the version pinned in package.json "packageManager".
# python3, make and g++: pnpm runs better-sqlite3's node-gyp install step (node-gyp comes with pnpm); the
# toolchain stays in this stage, the runtime image below gets only node_modules and the build output.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@10.12.1
WORKDIR /src
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm vite build --config vite.node.config.ts && pnpm prune --prod --ignore-scripts

FROM node:26-slim AS runtime
ARG VERSION=dev
LABEL org.opencontainers.image.title="RESORIXtrack" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/RESORIX-AG/RESORIXtrack" \
      org.opencontainers.image.vendor="RESORIX AG" \
      org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production RESORIXTRACK_DATA_DIR=/data MIGRATIONS_DIR=/app/drizzle PORT=8080
RUN apt-get update && apt-get install -y --no-install-recommends tzdata sqlite3 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin resorixtrack \
 && mkdir -p /data /app && chown resorixtrack:resorixtrack /data
WORKDIR /app
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY --from=build /src/drizzle ./drizzle
COPY --from=build /src/package.json /src/server.mjs ./
COPY docker/entrypoint.sh /app/entrypoint.sh
COPY docker/rt /usr/local/bin/rt
RUN chmod +x /app/entrypoint.sh /usr/local/bin/rt
USER resorixtrack
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["web"]
