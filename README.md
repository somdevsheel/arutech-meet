# Arutech Meet

A production-grade video meeting, online classroom, and calling platform, built by
**Arutech Consultancy Services LLP**.

> Status: active development. The core meeting loop (register → login → create meeting → join from a
> second session → two-way audio/video → chat → screen share → host controls → leave/end), the
> classroom loop (class → session → attendance → whiteboard → poll → quiz → breakout rooms), recording
> (real LiveKit Egress → S3/MinIO), and an admin dashboard are all implemented end-to-end on web; a React
> Native mobile app covers the meeting loop. AI meeting assistant (transcription/summary) is deliberately
> deferred — see `docs/roadmap.md` for exactly what's built vs. staged.

## Product overview

Arutech Meet provides three experiences on one account, across web and native mobile:

- **Meetings** — instant/scheduled/recurring video meetings with waiting room, chat, screen share,
  recording (real LiveKit Egress → S3/MinIO, not a stub — see `docs/webrtc.md` §Recording), and
  centrally-enforced host/co-host controls.
- **Online classrooms** — teacher/student sessions built on the exact same meeting engine (a class
  session is just a `Meeting` of type `CLASS`), with real attendance tracking (derived from LiveKit
  presence events), a live synced whiteboard, polls, quizzes with leaderboards, and breakout rooms.
- **Calls** — 1:1 and group calling, sharing the same LiveKit-based media engine as meetings rather than a
  second, parallel implementation.

## Architecture

```
                 Cloud Load Balancer
                        │
                      NGINX
                        │
          ┌──────────────┼──────────────┐
          │              │              │
         Web            API        WebSocket GW
     (Next.js)      (NestJS REST)   (same NestJS
                                     process as API)
          │              │              │
          └──────────────┼──────────────┘
                         │
              PostgreSQL + Redis
                         │
                    Media Layer
                         │
                  LiveKit SFU cluster
                         │
                Recording Workers (staged)
                         │
                  Object Storage (S3/MinIO)
```

The Node.js API is the source of truth for auth, meeting/participant authorization, and metadata — it
never proxies audio/video. Media is routed by a **LiveKit SFU**, chosen over both P2P mesh (doesn't
scale) and a bare mediasoup build-out (more custom code to operate) — see `docs/architecture.md` §3 for
the full rationale. Full documentation: `docs/architecture.md`, `docs/database.md`, `docs/api.md`,
`docs/realtime.md`, `docs/webrtc.md`, `docs/security.md`, `docs/deployment.md`, `docs/roadmap.md`.

## Tech stack

| Layer | Choice |
|---|---|
| Web | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| Mobile | React Native 0.86 (bare CLI, real Android/iOS native projects), TypeScript, React Navigation |
| Media client | `livekit-client` + `@livekit/components-react` (web), `@livekit/react-native` (mobile) |
| Backend | NestJS (TypeScript), REST + Swagger/OpenAPI, Socket.IO (Redis adapter) |
| Database | PostgreSQL via Prisma |
| Cache / realtime infra | Redis (sessions cache, presence, pub/sub, rate limiting — never the source of truth) |
| Media server | LiveKit (self-hosted SFU) |
| Object storage | S3-compatible (MinIO locally) |
| Monorepo | pnpm workspaces + Turborepo |

## Repository structure

```
arutech-meet/
├── apps/
│   ├── web/            Next.js web client
│   ├── mobile/          React Native app (bare CLI — real Android/iOS native projects)
│   └── api/             NestJS API + WebSocket gateway + LiveKit integration
├── packages/
│   ├── types/            Shared roles, capability matrix, WS event contracts
│   ├── validation/       Shared Zod DTOs (client + server)
│   ├── config/           Validated env schema
│   └── database/         Prisma schema + client singleton
├── services/              Recording / transcription workers (staged — see roadmap)
├── infrastructure/
│   └── docker/            Production Dockerfiles + local LiveKit/Egress config
├── docs/                   Architecture, database, API, realtime, WebRTC, security, deployment, roadmap
└── docker-compose.yml      Local dev stack: Postgres, Redis, MinIO, LiveKit, Egress, api, web
```

`apps/admin` is on the roadmap (Stage 9) and not yet scaffolded — see `docs/roadmap.md` before assuming
it exists. `apps/mobile` has its own setup/testing notes and known gaps in `apps/mobile/README.md`.

## Local setup

Prerequisites: Node.js 20+, pnpm 9 (`corepack enable && corepack prepare pnpm@9.15.9 --activate`), Docker.

```bash
cp .env.example .env.development   # already provided; edit if you change ports/secrets
pnpm install
pnpm db:generate

# Start Postgres, Redis, MinIO, LiveKit, the Egress recording worker, and both
# apps in dev mode:
docker compose up

# In a separate shot, once Postgres is up, run migrations + seed data:
pnpm db:migrate
pnpm db:seed
```

Then open:

- Web: http://localhost:3000
- API: http://localhost:4000 (Swagger docs at http://localhost:4000/docs, health at `/health`)
- MinIO console: http://localhost:9001 (`arutech_minio` / `arutech_minio_secret`)
- LiveKit: ws://localhost:7880

Seeded login: `owner@arutech.dev` / `Password123!`, or `admin@arutech.dev` / `Password123!` for the admin
dashboard at `/admin` (see `packages/database/prisma/seed.ts`).

### Running without Docker

You can also run Postgres/Redis/MinIO/LiveKit yourself and just run the apps directly:

```bash
pnpm --filter @arutech/api dev
pnpm --filter @arutech/web dev
```

Point `DATABASE_URL`/`REDIS_URL`/`LIVEKIT_*`/`S3_*` in `.env.development` (API) and
`apps/web/.env.local` (web) at wherever those services actually are.

## Testing

```bash
pnpm test        # unit tests (Jest) across the workspace
pnpm typecheck    # TypeScript project references, no emit
pnpm lint         # ESLint
pnpm build        # production build of every app/package
```

`apps/api` unit tests cover the authorization matrix, refresh-token rotation/reuse detection, and the
meeting-code generator — see `apps/api/src/**/*.spec.ts`. E2E (Playwright, web) and mobile E2E (Detox)
are on the roadmap.

## Deployment

See `docs/deployment.md` for the production topology, Dockerfiles (`infrastructure/docker/`), and CI
(`.github/workflows/ci.yml`). Kubernetes/Terraform manifests are not yet implemented (Stage 10 in
`docs/roadmap.md`).

## Security

See `docs/security.md`. Highlights: Argon2id password hashing, JWT access + rotating refresh tokens with
reuse detection, a single server-enforced capability matrix for every meeting/class action (never trust
the frontend), and an explicit statement of what the current transport encryption does *not* cover
(it is not end-to-end encryption — see `docs/webrtc.md` §"End-to-end encryption").

## License

Proprietary — © Arutech Consultancy Services LLP.
