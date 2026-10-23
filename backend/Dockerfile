# syntax=docker/dockerfile:1
# Base images are pinned by tag and digest: bump both together.

# ── Stage 1: Chef — cargo-chef on the build toolchain ──
FROM rust:1.99.1-trixie@sha256:931c2c0531a8b143e044f0f3914dfe802f15bb3d1955f0b657e9359327ac2ffc AS chef
RUN cargo install cargo-chef --locked --version 0.1.78
WORKDIR /app

# ── Stage 2: Planner — dependency recipe ───────
FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY src/ src/
RUN cargo chef prepare --recipe-path recipe.json

# ── Stage 3: Builder — cached dependency build ─
FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
# Dependencies only rebuild when the recipe (Cargo.toml/Cargo.lock) changes.
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    cargo chef cook --release --locked --recipe-path recipe.json

COPY Cargo.toml Cargo.lock ./
COPY src/ src/
# docs/ and migrations/ are embedded in the binary with include_str!.
COPY docs/ docs/
COPY migrations/ migrations/
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    cargo build --release --locked

# ── Stage 4: Runtime ───────────────────────────
FROM debian:trixie-20261020-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad AS runtime

# ca-certificates: outbound TLS (Clerk, Gemini, S3, GitHub, Postgres).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --no-create-home --shell /usr/sbin/nologin baaton \
    && mkdir -p /app/data/uploads \
    && chown baaton:baaton /app/data/uploads

COPY --from=builder /app/target/release/baaton-api /usr/local/bin/baaton-api

USER baaton
WORKDIR /app

ENV PORT=4000
EXPOSE 4000

# No HEALTHCHECK here — let Dokploy/Swarm handle it.
CMD ["baaton-api"]
