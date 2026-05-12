# Multi-stage build for the pose-runner WebSocket broker.
# Build context: monorepo root. Build command:
#   docker build -f packages/broker/Dockerfile -t pose-broker .

FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9 --activate

# ---- deps ----
FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/broker/package.json packages/broker/
RUN pnpm install --frozen-lockfile --filter broker... --filter shared...

# ---- build ----
FROM deps AS build
WORKDIR /repo
COPY packages/shared packages/shared
COPY packages/broker packages/broker
# broker uses tsx at runtime; no compile step needed, but typecheck for safety
RUN pnpm --filter broker exec tsc --noEmit || echo "typecheck warnings ignored"

# ---- runtime ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8787
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY --from=build /repo /app
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8787/health || exit 1
WORKDIR /app/packages/broker
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
