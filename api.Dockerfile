# Build context: project root (../)
FROM rust:slim-bookworm AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY common/ common/
COPY api/ api/

WORKDIR /build/api
RUN cargo build --release --features postgres --no-default-features

# Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/api/target/release/server /usr/local/bin/server

EXPOSE 8080
CMD ["server"]
