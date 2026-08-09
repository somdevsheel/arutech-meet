# Deployment

## Local development

`docker-compose.yml` at the repo root brings up the full stack: PostgreSQL, Redis, MinIO (S3-compatible
storage), the LiveKit SFU, and the API/Web apps running in dev mode with the repo bind-mounted. See the
root `README.md` "Local setup" section for the exact commands. This is a development convenience stack,
not the production topology below — the `api`/`web` services there run `next dev`/`nest start --watch`
against a live-mounted volume, not built production images.

## Production architecture (target)

```
                    Cloud Load Balancer
                           │
                         NGINX
                           │
             ┌─────────────┼─────────────┐
             │             │             │
            Web           API        WebSocket GW
        (Next.js,      (NestJS,      (same NestJS
         N replicas)    N replicas)   process as API;
                                      scales with it)
             │             │             │
             └─────────────┼─────────────┘
                           │
                PostgreSQL (managed, primary+replica)
                           │
                    Redis (managed, cluster mode)
                           │
                       Media Layer
                           │
                LiveKit SFU cluster (Redis-coordinated)
                           │
                  Recording/Transcription Workers
                           │
                     Object Storage (S3)
```

Notes:

- `apps/api` and the WebSocket gateway are the same NestJS process in this codebase (see
  `apps/api/src/app.module.ts` — `RealtimeModule` is just another module in the same app), so they scale
  together as one stateless deployment behind the load balancer. Splitting the WebSocket gateway into its
  own deployment later is possible without an application-code change, since it already only depends on
  Redis (adapter + broadcast bridge) for cross-instance state — no in-memory state would need migrating.
- LiveKit runs as its own cluster, independent of the API's scaling — see `docs/webrtc.md`.
- Recording/transcription run as separate worker processes/deployments (`services/recording`,
  `services/transcription`) consuming events rather than being invoked synchronously from a request path,
  so a slow or failed egress never blocks a meeting.

## Containers

Production Dockerfiles: `infrastructure/docker/api.Dockerfile`, `infrastructure/docker/web.Dockerfile`
(multi-stage: install → build → slim runtime image, non-root user). Build them with the repo root as
build context (they need the pnpm workspace, not just the individual app directory):

```bash
docker build -f infrastructure/docker/api.Dockerfile -t arutech-meet-api .
docker build -f infrastructure/docker/web.Dockerfile -t arutech-meet-web .
```

## Kubernetes / Terraform

Not yet implemented — `infrastructure/kubernetes/` and `infrastructure/terraform/` are placeholders for
Stage 10 (see `docs/roadmap.md`). The target shape: a Deployment + HorizontalPodAutoscaler for `api` and
`web` each, a StatefulSet or managed service for PostgreSQL/Redis, a separate LiveKit Helm release (the
LiveKit project publishes one), and Jobs/Deployments for the recording and transcription workers. NGINX
Ingress (or a cloud load balancer + Ingress controller) terminates TLS and routes `/`, `/api`, and the
WebSocket upgrade path to the corresponding Services.

## CI/CD

`.github/workflows/ci.yml` runs on every PR: typecheck → lint → unit tests → build, across the whole
pnpm workspace via Turborepo's task graph (so only affected packages re-run on incremental changes). A
`main`-branch deploy workflow (build+push Docker images, security scan, deploy) is described in
`docs/roadmap.md` Stage 10 and not yet implemented — do not assume images are being published anywhere
yet.

## Environment

See `.env.example` for the full variable list and `docs/architecture.md` for what each subsystem uses
its variables for. Never commit a real `.env` — only the `.example`/`.development`/`.test` templates are
tracked, and `.env.production.example` contains placeholders only (`REPLACE_WITH_...`), never real
secrets.
