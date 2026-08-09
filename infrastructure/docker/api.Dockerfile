# Build context MUST be the repo root (needs the full pnpm workspace):
#   docker build -f infrastructure/docker/api.Dockerfile -t arutech-meet-api .
syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /workspace

# ---- deps: install the full workspace's dependencies (cached unless lockfile changes) ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/validation/package.json packages/validation/package.json
RUN pnpm install --frozen-lockfile

# ---- build: compile the API and its workspace dependencies ----
FROM deps AS build
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @arutech/database exec prisma generate
RUN pnpm --filter @arutech/database... --filter @arutech/api build

# ---- runtime: slim image with only production deps + compiled output ----
FROM base AS runtime
ENV NODE_ENV=production
RUN addgroup -S arutech && adduser -S arutech -G arutech

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/validation/package.json packages/validation/package.json
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/packages/database/prisma ./packages/database/prisma
COPY --from=build /workspace/packages/database/dist ./packages/database/dist
COPY --from=build /workspace/packages/types/dist ./packages/types/dist
COPY --from=build /workspace/packages/config/dist ./packages/config/dist
COPY --from=build /workspace/packages/validation/dist ./packages/validation/dist
COPY --from=build /workspace/node_modules/.prisma ./node_modules/.prisma

USER arutech
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
