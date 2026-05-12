# Multi-stage build: vite build → nginx static serve.
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/controller/package.json packages/controller/
RUN pnpm install --frozen-lockfile --filter controller... --filter shared...
COPY packages/shared packages/shared
COPY packages/controller packages/controller
ARG VITE_BROKER_URL
ENV VITE_BROKER_URL=$VITE_BROKER_URL
RUN pnpm --filter controller build

FROM nginx:alpine AS runtime
COPY --from=build /repo/packages/controller/dist /usr/share/nginx/html
COPY packages/controller/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
