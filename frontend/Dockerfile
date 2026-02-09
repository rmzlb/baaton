# ── Stage 1: Build ─────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install deps first (cache layer)
COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps

# Copy source + build
COPY . .

# Clerk key must be available at build time for Vite
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_API_URL
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ── Stage 2: Serve ─────────────────────────────
FROM nginx:1.27-alpine

# Security: remove default config
RUN rm -rf /etc/nginx/conf.d/default.conf /usr/share/nginx/html/*

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# No HEALTHCHECK in Dockerfile — let Dokploy/Swarm handle it

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
