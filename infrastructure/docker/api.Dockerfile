# syntax=docker/dockerfile:1.7
# ^ Must be line 1 with the `#` prefix — BuildKit only honors this parser
# directive there; it silently becomes an invalid instruction otherwise (this
# file had exactly that bug — no leading `#` — until it was caught by an actual
# `docker build` run, not just review).
#
# Build context MUST be the repo root (needs the full pnpm workspace):
#   docker build -f infrastructure/docker/api.Dockerfile -t arutech-meet-api .

FROM node:20-alpine AS base
# Alpine ships no OpenSSL CLI/lib by default; Prisma's query-engine binary needs
# one present to load correctly (paired with the explicit `binaryTargets` in
# schema.prisma — see the comment there for what broke without both).
RUN apk add --no-cache openssl
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
# `@arutech/api...` (trailing `...`) selects @arutech/api AND every workspace
# package it depends on (config, database, types, validation) — NOT just api
# itself. An earlier version of this line used `@arutech/database... --filter
# @arutech/api` (no trailing `...` on api), which silently skipped building
# config/types/validation, leaving api unable to resolve their compiled types.
RUN pnpm --filter "@arutech/api..." build

# ---- runtime ----
# Copies the entire build-stage /workspace filesystem rather than cherry-picking
# individual node_modules paths. An earlier version tried the latter (a fresh
# `pnpm install --prod` here, plus hand-picked COPY lines including
# `node_modules/.prisma`) and it does not work under pnpm's workspace layout: the
# generated Prisma client/query-engine binary lives inside a content-addressed
# `node_modules/.pnpm/@prisma+client@<hash>/...` path, and each package's
# `workspace:*` dependencies resolve via symlinks scoped to THAT install — a
# second, separate `pnpm install` in this stage produces a different store
# layout (and never even generates the Prisma client at all, since `prisma`
# itself is a devDependency `--prod` skips). This was only caught by actually
# running `docker build`, not by review. Trade-off: this image carries
# devDependencies and .ts sources it doesn't strictly need — `pnpm deploy`
# (a purpose-built pnpm command for producing a minimal standalone bundle for
# one workspace package) is the documented follow-up if image size becomes a
# real constraint; correctness came first here.
FROM base AS runtime
ENV NODE_ENV=production
# ffmpeg is shelled out to by the AI meeting assistant pipeline (apps/api/src/ai
# TranscriptsService) to extract/chunk audio from a recording before sending it
# to a transcription provider — see that file's doc comment. Not needed by any
# other part of the API; only added here, not to web/mobile images.
RUN apk add --no-cache ffmpeg
RUN addgroup -S arutech && adduser -S arutech -G arutech

COPY --from=build /workspace /workspace

USER arutech
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
