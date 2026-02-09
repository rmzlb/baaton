# ── Stage 1: Chef — compute dependency recipe ──
FROM rust:1.84-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /app

# ── Stage 2: Planner — capture deps ────────────
FROM chef AS planner
COPY Cargo.toml ./
COPY src/ src/
# Generate Cargo.lock if missing
RUN cargo generate-lockfile
RUN cargo chef prepare --recipe-path recipe.json

# ── Stage 3: Builder — cached dep compilation ──
FROM chef AS builder

# Cache: compile deps separately (only recompiles when Cargo.toml changes)
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

# Now copy real source and build (only our code recompiles — seconds, not minutes)
COPY Cargo.toml ./
COPY src/ src/
COPY migrations/ migrations/
RUN cargo generate-lockfile

RUN cargo build --release

# ── Stage 4: Runtime — minimal image (~20MB) ───
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

# Non-root user for security
RUN useradd -r -s /bin/false baaton
USER baaton

COPY --from=builder /app/target/release/baaton-api /usr/local/bin/baaton-api
COPY --from=builder /app/migrations /app/migrations

ENV PORT=4000
EXPOSE 4000

# Health check via /health endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["baaton-api"]
