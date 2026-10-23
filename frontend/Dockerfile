# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv
# (the only build args are public: Clerk publishable key and API URL)
# Base images are pinned by tag and digest: bump both together.

# ── Stage 1: Build ─────────────────────────────
FROM node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS builder
WORKDIR /app

# Dependencies first, installed strictly from package-lock.json (same as CI).
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

COPY . .

# Public build-time values only: Vite inlines every VITE_* into the bundle.
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_API_URL
RUN npm run build

# ── Stage 2: Serve ─────────────────────────────
# Unprivileged nginx: runs as uid 101 (port 80, see nginx.conf).
FROM nginxinc/nginx-unprivileged:1.30.6-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx-security-headers.conf nginx-html-headers.conf /etc/nginx/snippets/
COPY --from=builder /app/dist /usr/share/nginx/html

# No HEALTHCHECK here — let Dokploy/Swarm handle it.
EXPOSE 80
