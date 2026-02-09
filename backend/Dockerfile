FROM rust:1.84-bookworm AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src/ src/
COPY migrations/ migrations/

# Build with sqlx offline mode
ENV SQLX_OFFLINE=true
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/baaton-api /usr/local/bin/baaton-api
COPY --from=builder /app/migrations /app/migrations

ENV PORT=4000
EXPOSE 4000

CMD ["baaton-api"]
