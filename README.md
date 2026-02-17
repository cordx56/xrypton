# Crypton

Crypton is an end-to-end encrypted chat application built with a Rust backend and a React (Next.js) frontend. All messages are encrypted client-side using PGP, so the server never has access to plaintext content. Authentication is passwordless — users prove their identity by signing challenges with their PGP private key.

## Features

- **End-to-End Encryption** — Messages are encrypted and decrypted entirely in the browser using PGP (Ed25519 + ECDH Curve25519). The server stores only ciphertext.
- **PGP Key-Based Authentication** — No passwords. Users register a PGP key pair and authenticate by signing a nonce with their private key. Replay attacks are prevented by nonce tracking.
- **WebAssembly Cryptography** — PGP operations run in a Web Worker via WebAssembly for performance without blocking the UI.
- **Group Chat with Threads** — Create chat groups with multiple members, organize conversations into threads.
- **Web Push Notifications** — Receive push notifications via the VAPID protocol, handled by a Service Worker.
- **Distributed-Ready Architecture** — Designed to support distributed deployment across multiple domains/servers.

## Architecture

```
crypton/
├── api/       Rust API server (Axum, SQLx)
├── common/    Shared library (Rust + TypeScript schemas)
├── wasm/      WebAssembly module for PGP operations
├── web/       Next.js web frontend
└── ecs/       Terraform infrastructure (AWS ECS)
```

### crypton-api

REST API server built with [Axum](https://github.com/tokio-rs/axum). Supports SQLite (default, for development) and PostgreSQL (for production, via feature flag). Uses S3-compatible object storage for profile icons and the VAPID protocol for Web Push notifications.

### crypton-common

Shared code used by both the API server and the WASM module. The Rust side provides PGP key parsing and signature verification. The TypeScript side (under `ts/`) provides Zod schemas for API request/response types and worker messages.

### crypton-wasm

A WebAssembly module compiled from Rust with [wasm-pack](https://rustwasm.github.io/wasm-pack/). Exposes PGP key generation, encryption, decryption, signing, and verification functions to the browser. Runs inside a Web Worker to keep the UI responsive.

### crypton-web

The frontend, built with Next.js 16, React 19, and Tailwind CSS 4. All cryptographic operations happen client-side via the WASM module. Includes a Service Worker for push notifications and offline support.

## Development

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/)

### API Server

```bash
cd api
cp .env.example .env
# Edit .env if needed (see Environment Variables below)
cargo run --bin server
```

The server listens on `http://localhost:8080` by default.

#### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite:crypton.db?mode=rwc` | Database connection string |
| `LISTEN_ADDR` | `0.0.0.0:8080` | Server listen address |
| `S3_BUCKET` | `crypton` | S3 bucket name for profile icons |
| `S3_ENDPOINT` | — | S3-compatible endpoint URL (e.g. MinIO, Cloudflare R2) |
| `S3_REGION` | `auto` | S3 region |
| `VAPID_PUBLIC_KEY` | — | Base64url-encoded VAPID public key for Web Push |
| `VAPID_PRIVATE_KEY` | — | Base64url-encoded VAPID private key for Web Push |

### Web Frontend

```bash
# Build the WASM module first
cd wasm
wasm-pack build --target web

# Then start the dev server
cd ../web
pnpm install
pnpm dev
```

The dev server starts at `http://localhost:3000`. API requests are proxied to `http://localhost:8080` by default.

### Docker

Build from the project root:

```bash
# API (builds with PostgreSQL support)
docker build -t crypton-api -f api.Dockerfile .

# Web
docker build -t crypton-web -f web.Dockerfile .
```

Run:

```bash
docker run -p 8080:8080 \
  -e DATABASE_URL="postgres://user:pass@host/crypton" \
  crypton-api

docker run -p 3000:3000 \
  -e NEXT_PUBLIC_API_BASE_URL=/api \
  crypton-web
```

## License

This project is licensed under the [Mozilla Public License 2.0](LICENSE).
