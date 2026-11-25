# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build (Node 22 LTS, Alpine) ----------
FROM node:22-alpine AS build
WORKDIR /app

# Install from the lockfile only (Web A03 supply chain): reproducible, no silent upgrades.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY angular.json tsconfig.json tsconfig.app.json ./
COPY public ./public
COPY src ./src
RUN npm run build -- --configuration production

# ---------- Stage 2: runtime (non-root nginx) ----------
FROM nginxinc/nginx-unprivileged:alpine AS runtime

LABEL org.opencontainers.image.title="finops-dashboard" \
      org.opencontainers.image.description="FinOps Enterprise Dashboard (Angular SPA, OWASP-hardened)"

USER root
RUN rm -f /etc/nginx/conf.d/default.conf && mkdir -p /etc/nginx/snippets
COPY --chown=root:root nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=root:root nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build --chown=root:root /app/dist/finops-dashboard/browser /usr/share/nginx/html

# Content is read-only for the runtime user; nginx runs as uid 101.
USER 101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
