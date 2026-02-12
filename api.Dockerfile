# Build context: project root (../)
FROM rust:slim-bookworm AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY crypton-common/ crypton-common/
COPY crypton-api/ crypton-api/

WORKDIR /build/crypton-api
RUN cargo build --release --features postgres --no-default-features

# Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/crypton-api/target/release/server /usr/local/bin/server

EXPOSE 8080
CMD ["server"]
