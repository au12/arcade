# syntax=docker/dockerfile:1

# ── the launcher app ──
FROM node:24-alpine AS web
WORKDIR /src
COPY package.json VERSION ./
COPY sdk ./sdk
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --no-audit --no-fund
COPY web ./web
RUN cd web && node build.mjs

# ── the server: Node and its built-in SQLite, nothing else ──
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data
WORKDIR /app
COPY package.json VERSION ./
COPY server ./server
COPY catalog ./catalog
COPY sdk ./sdk
COPY --from=web /src/web/dist ./web/dist

# /data holds the database: players, scores, tickets, settings.
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data
USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js", "-healthcheck"]

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
