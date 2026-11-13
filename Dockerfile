# syntax=docker/dockerfile:1
FROM node:22-alpine AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS backend-deps
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine
RUN apk add --no-cache ca-certificates tzdata curl \
 && addgroup -g 10001 -S kubepanel \
 && adduser -u 10001 -S kubepanel -G kubepanel \
 && mkdir -p /app/kube/clusters /app/public /app/data \
 && chown -R 10001:10001 /app
ARG BUILD_REVISION=development
ARG SOURCE_MANIFEST_SHA256=development
LABEL org.opencontainers.image.title="KubePanel" \
      org.opencontainers.image.description="Lightweight Kubernetes Web Dashboard" \
      org.opencontainers.image.version="1.5.0" \
      org.opencontainers.image.revision=$BUILD_REVISION \
      io.kubepanel.source-manifest-sha256=$SOURCE_MANIFEST_SHA256
ENV NODE_ENV=production PORT=8080 TZ=Asia/Shanghai \
    PUBLIC_DIR=/app/public KUBE_CLUSTERS_DIR=/app/kube/clusters DATA_DIR=/app/data \
    DASHBOARD_TOKEN_TTL=12h BUILD_REVISION=$BUILD_REVISION SOURCE_MANIFEST_SHA256=$SOURCE_MANIFEST_SHA256
WORKDIR /app
COPY --from=backend-deps --chown=10001:10001 /build/server/node_modules /app/node_modules
COPY --chown=10001:10001 server/src/ /app/server/src/
COPY --chown=10001:10001 server/index.js server/package.json /app/server/
COPY --from=frontend-builder --chown=10001:10001 /build/frontend/dist /app/public
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/livez" || exit 1
CMD ["node", "server/index.js"]
