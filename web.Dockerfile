# Build context: project root (../)

# Stage 1: Build crypton-wasm
FROM rust:slim AS wasm-builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev curl && rm -rf /var/lib/apt/lists/*
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

WORKDIR /build
COPY crypton-common/ crypton-common/
COPY crypton-wasm/ crypton-wasm/

WORKDIR /build/crypton-wasm
RUN wasm-pack build --target web

# Stage 2: Build Next.js app
FROM node:22-slim AS web-builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /build/crypton-web

COPY crypton-web/package.json crypton-web/pnpm-lock.yaml ./
COPY --from=wasm-builder /build/crypton-wasm/pkg /build/crypton-wasm/pkg
RUN pnpm install --frozen-lockfile

COPY crypton-web/ .

# NEXT_PUBLIC_* variables must be set at build time
ARG NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ARG NEXT_PUBLIC_SERVER_HOSTNAME
ENV NEXT_PUBLIC_SERVER_HOSTNAME=${NEXT_PUBLIC_SERVER_HOSTNAME}

RUN pnpm build

# Stage 3: Runtime
FROM node:22-slim AS runner

WORKDIR /app

COPY --from=web-builder /build/crypton-web/.next/standalone ./
COPY --from=web-builder /build/crypton-web/.next/static ./.next/static
COPY --from=web-builder /build/crypton-web/public ./public

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000
CMD ["node", "server.js"]
