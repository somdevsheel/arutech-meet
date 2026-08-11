# syntax=docker/dockerfile:1.7
#
# Build context MUST be the repo root:
#   docker build -f infrastructure/docker/web.Dockerfile -t arutech-meet-web .

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /workspace

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/validation/package.json packages/validation/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_LIVEKIT_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_LIVEKIT_URL=$NEXT_PUBLIC_LIVEKIT_URL
COPY packages/types ./packages/types
COPY packages/validation ./packages/validation
COPY apps/web ./apps/web
# @arutech/types and @arutech/validation's package.json "main"/"types" point at
# their compiled dist/ output (not raw .ts source — see the comment in
# packages/types/package.json history / docs/deployment.md), so they must be
# built before `next build` can resolve them, same as api.Dockerfile.
RUN pnpm --filter "@arutech/web..." build

FROM base AS runtime
ENV NODE_ENV=production
RUN addgroup -S arutech && adduser -S arutech -G arutech

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/validation/package.json packages/validation/package.json
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /workspace/apps/web/.next ./apps/web/.next
COPY --from=build /workspace/apps/web/public ./apps/web/public
COPY --from=build /workspace/apps/web/next.config.js ./apps/web/next.config.js
COPY --from=build /workspace/packages/types/dist ./packages/types/dist
COPY --from=build /workspace/packages/validation/dist ./packages/validation/dist

USER arutech
WORKDIR /workspace/apps/web
EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "-p", "3000"]
