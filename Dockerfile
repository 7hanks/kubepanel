# syntax=docker/dockerfile:1
# KubePanel 多阶段构建：前端 Vite 构建 -> 后端生产依赖 -> 精简运行镜像

# ---------- Stage 1：构建前端 ----------
FROM node:22-alpine AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- Stage 2：安装后端生产依赖 ----------
FROM node:22-alpine AS backend-deps
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --registry=https://registry.npmmirror.com --no-audit --no-fund

# ---------- Stage 3：运行镜像 ----------
FROM node:22-alpine
LABEL org.opencontainers.image.title="KubePanel" \
      org.opencontainers.image.description="Lightweight Kubernetes Web Dashboard" \
      org.opencontainers.image.version="1.4.0"

# curl 供 HEALTHCHECK 使用；tzdata 让日志/时间显示符合本地时区
RUN apk add --no-cache ca-certificates tzdata curl \
 && addgroup -g 10001 -S kubepanel \
 && adduser -u 10001 -S kubepanel -G kubepanel \
 && mkdir -p /app/kube/clusters /app/public /app/data \
 && chown -R 10001:10001 /app

ENV NODE_ENV=production \
    PORT=8080 \
    TZ=Asia/Shanghai \
    PUBLIC_DIR=/app/public \
    KUBE_CLUSTERS_DIR=/app/kube/clusters \
    DATA_DIR=/app/data \
    DASHBOARD_TOKEN_TTL=12h

WORKDIR /app

COPY --from=backend-deps --chown=10001:10001 /build/server/node_modules /app/node_modules
COPY --chown=10001:10001 server/ /app/server/
COPY --from=frontend-builder --chown=10001:10001 /build/frontend/dist /app/public

# 以固定 UID 10001 运行：集群目录属主设为 10001 即可保持 600 权限，无需 root
# 该目录需「可写」，界面导入的 kubeconfig 会落在这里，重启后依然有效
USER 10001:10001
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["node", "server/index.js"]
