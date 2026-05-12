# Multi-stage build: vite build → nginx static serve.
# Build context: monorepo root.
#   docker build -f packages/tv/Dockerfile \
#     --build-arg VITE_BROKER_URL=wss://pose-broker.example.com \
#     --build-arg VITE_CONTROLLER_URL=https://pose-ctl.example.com \
#     -t pose-tv .

FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/tv/package.json packages/tv/
RUN pnpm install --frozen-lockfile --filter tv... --filter shared...
COPY packages/shared packages/shared
COPY packages/tv packages/tv
ARG VITE_BROKER_URL
ARG VITE_CONTROLLER_URL
ENV VITE_BROKER_URL=$VITE_BROKER_URL
ENV VITE_CONTROLLER_URL=$VITE_CONTROLLER_URL
RUN pnpm --filter tv build

FROM nginx:alpine AS runtime
COPY --from=build /repo/packages/tv/dist /usr/share/nginx/html
COPY packages/tv/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
