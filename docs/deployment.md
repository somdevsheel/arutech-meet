# Deployment

## Local development

`docker-compose.yml` at the repo root brings up the full stack: PostgreSQL, Redis, MinIO (S3-compatible
storage), the LiveKit SFU, the Egress recording worker, and the API/Web apps running in dev mode with the
repo bind-mounted. An optional `nginx` profile (`docker compose --profile nginx up`) fronts everything
with the same reverse-proxy config used in production (`infrastructure/nginx/nginx.conf`). See the root
`README.md` "Local setup" section for the exact commands. This is a development convenience stack, not
the production topology below — the `api`/`web` services there run `next dev`/`nest start --watch`
against a live-mounted volume, not built production images.

## Production architecture

```
                    Cloud Load Balancer
                           │
                    NGINX Ingress (TLS termination, cert-manager)
                           │
             ┌─────────────┼─────────────┐
             │             │             │
            Web           API        WebSocket GW
        (Next.js,      (NestJS,      (same NestJS
      N replicas, HPA) N replicas,    process as API;
                        HPA)          scales with it)
             │             │             │
             └─────────────┼─────────────┘
                           │
            PostgreSQL (RDS, Multi-AZ) + Redis (ElastiCache, replicated)
                           │
                       Media Layer
                           │
              LiveKit SFU (hostNetwork, Redis-coordinated)
                           │
                Egress Recording Workers (SYS_ADMIN, headless Chrome)
                           │
                     Object Storage (S3)
```

Notes:

- `apps/api` and the WebSocket gateway are the same NestJS process in this codebase (see
  `apps/api/src/app.module.ts` — `RealtimeModule` is just another module in the same app), so they scale
  together as one stateless deployment behind the load balancer. Splitting the WebSocket gateway into its
  own deployment later is possible without an application-code change, since it already only depends on
  Redis (adapter + broadcast bridge) for cross-instance state — no in-memory state would need migrating.
- LiveKit runs with `hostNetwork: true` in Kubernetes (not behind a ClusterIP Service) — this is LiveKit's
  own documented deployment shape, not a shortcut: WebRTC needs to hand out ICE candidates on ports
  actually reachable from the internet, which a k8s Service can't cleanly front for an arbitrary UDP range.
  See `docs/webrtc.md` and `infrastructure/kubernetes/helm/arutech-meet/templates/livekit-deployment.yaml`.
- Recording runs via LiveKit's own Egress service (a separate Deployment, `SYS_ADMIN` capability for
  headless Chrome), not a custom `services/recording` worker — see `docs/webrtc.md` §Recording and the
  note in `docs/architecture.md` §4 about why that changed from the original plan.

## Containers

Production Dockerfiles: `infrastructure/docker/api.Dockerfile`, `infrastructure/docker/web.Dockerfile`
(multi-stage: install → build → runtime image, non-root user). Build them with the repo root as build
context (they need the pnpm workspace, not just the individual app directory):

```bash
docker build -f infrastructure/docker/api.Dockerfile -t arutech-meet-api .
docker build -f infrastructure/docker/web.Dockerfile -t arutech-meet-web \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_WS_URL=wss://api.example.com \
  --build-arg NEXT_PUBLIC_LIVEKIT_URL=wss://livekit.example.com \
  .
```

Both Dockerfiles were actually built and run in this repo's history, against real Postgres/Redis
containers, not just written and assumed correct — that process caught and fixed four real bugs (a
missing `#` on the `# syntax=` parser directive, a `pnpm --filter` expression that silently skipped
building three of the four workspace packages the API depends on, an attempt to reconstruct
node_modules in the runtime stage that doesn't work under pnpm's content-addressed store layout, and a
Prisma engine binary mismatch under Alpine's OpenSSL 3.x). See the Stage 10 commit for the full story;
the fixes are why the runtime stage copies the whole build-stage filesystem instead of a hand-picked
subset, and why `schema.prisma` declares explicit `binaryTargets`.

## Kubernetes / Helm

`infrastructure/kubernetes/helm/arutech-meet/` is a real Helm chart: Deployments + Services +
HorizontalPodAutoscalers for `api` and `web`, an Ingress (NGINX Ingress + cert-manager annotations), a
LiveKit Deployment (`hostNetwork`), an Egress Deployment, and ConfigMap/Secret templates. It does **not**
deploy PostgreSQL, Redis, or S3 — those are expected to be managed services (see Terraform below),
referenced via `values.yaml`'s `secrets.*` keys.

```bash
helm lint infrastructure/kubernetes/helm/arutech-meet
helm template arutech-meet infrastructure/kubernetes/helm/arutech-meet   # render without installing
helm install arutech-meet infrastructure/kubernetes/helm/arutech-meet \
  --set-string secrets.databaseUrl=... --set-string secrets.redisUrl=... # ...and the rest of secrets.*
```

`helm lint` and `helm template` were run for real against this chart (every rendered document parsed and
checked for required Kubernetes fields) — see the Stage 10 commit. **Not** validated: an actual
`kubectl apply` against a live cluster (none was available in the environment this was built in). Read
`templates/NOTES.txt` (shown after `helm install`) before treating a deployment as done — in particular,
the `NEXT_PUBLIC_*` values in the ConfigMap are for reference only and do not affect an already-built web
image (Next.js inlines them at `docker build` time, not read from the environment at pod startup).

## Terraform (AWS reference)

`infrastructure/terraform/` provisions the managed infrastructure the Helm chart expects: VPC, EKS
cluster, RDS PostgreSQL (Multi-AZ), ElastiCache Redis (replicated), and an S3 bucket with a lifecycle rule
mirroring `RecordingsCleanupService`'s retention window. AWS was chosen as one concrete reference
implementation — nothing in the application itself is AWS-specific (S3 access is the generic AWS SDK
against any S3-compatible endpoint). See `infrastructure/terraform/README.md` for the full module
breakdown, usage, and what was/wasn't verified (`terraform validate` passes for every module and the root
`environments/production` configuration; `terraform plan`/`apply` against a real account has not been run
— there is no AWS account in the environment this was built in).

## CI/CD

`.github/workflows/ci.yml`:

- **`build-and-test`** (every PR): typecheck → lint → unit tests → build → dependency audit, across the
  whole pnpm workspace via Turborepo's task graph.
- **`docker-build`** (every PR, after `build-and-test`): actually builds both production Docker images and
  scans them with Trivy. This job exists specifically because a green `pnpm build` does not mean the
  Docker image works — see the four bugs mentioned above, none of which `pnpm build` alone would have
  caught. Trivy currently reports rather than fails the build (`exit-code: "0"`) until a vulnerability
  baseline is triaged; flip that once it has been.
- **`deploy`** (main branch only): builds and would push both images to a registry, then run `helm
  upgrade`. Registry login and the actual deploy step are commented-out placeholders — wiring them up
  needs real registry/cluster credentials this repo doesn't have. Do not assume images are being
  published anywhere yet.

## Environment

See `.env.example` for the full variable list and `docs/architecture.md` for what each subsystem uses
its variables for. Never commit a real `.env` — only the `.example`/`.development`/`.test` templates are
tracked, and `.env.production.example` contains placeholders only (`REPLACE_WITH_...`), never real
secrets. Two variables added in Stage 10 worth calling out specifically:

- `S3_PUBLIC_ENDPOINT` — deliberately separate from `S3_ENDPOINT` in environments (like Docker Compose)
  where the API reaches storage over an internal hostname a browser can't resolve; presigned download
  URLs must be signed against the browser-reachable one. See `packages/config/src/env.ts`'s comment.
- `OTEL_EXPORTER_OTLP_ENDPOINT` / `SENTRY_DSN` — both fully opt-in (tracing/error-tracking bootstrap
  no-ops if unset, see `apps/api/src/observability/`); neither has been exercised against a live
  collector/Sentry project in this environment.
