# Implementation Roadmap

Tracks staged delivery per `docs/architecture.md`. Update the status column as work lands.

| Stage | Scope | Status |
|---|---|---|
| 1 | Monorepo, TS/lint/format config, env files | ✅ Done |
| 2 | Backend foundation: Postgres, Prisma schema, Redis, auth (JWT + refresh rotation), users, orgs, RBAC | ✅ Done |
| 3 | Meeting engine: meeting CRUD, join flow, LiveKit token service, WebSocket gateway (chat/presence/moderation), participant management | ✅ Done |
| 4 | Meeting UI (web): lobby/pre-join, meeting room, participant grid, controls, chat panel, screen share | ✅ Done |
| 5 | Mobile (React Native): auth, meeting list, join, A/V, push notifications | 🔶 Core loop + live pre-join camera preview + live waiting-room admit + Android screen share all real (see apps/mobile/README.md) — remaining gaps: no iOS screen share (needs an Xcode-only Broadcast Upload Extension target), push notifications architecture-only, iOS not build-verified (no macOS/Xcode available here) |
| 6 | Classroom: classes, attendance, whiteboard, polls, quizzes, breakout rooms | ✅ Backend + web UI done (mobile classroom UI not yet built — see apps/mobile/README.md) |
| 7 | Recording: egress worker, S3/MinIO storage, playback | ✅ Done — real LiveKit Egress integration, verified end-to-end for real (started a recording, watched it reach `READY`, confirmed the MP4 in MinIO, played it back) — see docs/roadmap.md §Recording and docs/webrtc.md §Recording |
| 8 | AI assistant: transcription pipeline, summary/action items, pluggable provider | ⏸️ Deliberately deferred (user decision) — schema (`meeting_transcripts`, `transcript_segments`, `ai_summaries`) and the "pluggable `AiProvider`, don't hardcode one vendor" architectural intent are in place; no pipeline code yet. Revisit as a future upgrade. |
| 9 | Admin dashboard | ✅ Backend + web UI done — Users, Organizations, Meetings, Classes, Recordings, Audit Logs, dashboard stats, system health. "Reports" and a dedicated Abuse/Security moderation queue are not built (see note below); admin has no dedicated mobile UI. |
| 10 | Production infra: k8s/Helm, Terraform, CI/CD, observability wiring | ✅ Done — see notes below |
| 11 | Home UI redesign + Team Chat, Contacts, Notes, personal meeting room, notifications, search, Apps launcher | ✅ Done — see notes below |

## Home UI redesign + new workspace features (Stage 11)

Prompted by a UI mockup the user wanted matched pixel-for-pixel; several of its elements (Team Chat,
Contacts, Notes, Apps, a persistent "personal meeting room") had no backend at all, so this stage built
real ones rather than static chrome — see the per-feature notes below. One deliberate exception: the
mockup's meeting-room pill read "End-to-end encrypted", which contradicts this app's own documented
security model (`docs/security.md`, `docs/webrtc.md` §"End-to-end encryption") — it's labeled "Encrypted"
instead, matching what's actually true (DTLS-SRTP/TLS transport encryption, not E2EE).

- **Personal meeting room**: `GET /meetings/personal` lazily creates (once) and forever reuses a
  standing `Meeting` per user (`Meeting.isPersonalRoom`) — same code every time, waiting room off. Required
  teaching `MeetingsEventsService`'s `room_finished` handler not to flip a personal room's status to
  `ENDED` the way a normal meeting does, or the owner would be permanently locked out after their first session.
- **Contacts**: derived entirely from real `MeetingParticipant` history (`ContactsService.list`) — everyone
  the caller has actually shared a `JOINED`/`LEFT` meeting with, no separate address book to maintain.
  "Call" creates a real instant meeting via the same `MeetingsService.create` the rest of the app uses and
  pushes the callee a real notification; "Message" opens/reuses a real `DIRECT` chat room. Deliberately
  *not* full ring/accept/decline calling — the `Call`/`CallParticipant` schema exists for that but has no
  service built around it yet, documented as a scoping decision in `ContactsService.call`, not hidden.
- **Team Chat**: reuses the existing `ChatRoom`/`ChatMember`/`ChatMessage` tables (previously wired only
  for meeting-scoped chat) for standing `GROUP`/`DIRECT` rooms, with real read receipts
  (`ChatMember.lastReadMessageId`) driving the unread badges — not a client-side-only "seen" flag.
- **Notes**: a new `Note` model, plain CRUD, private to their owner, optionally linked to a meeting.
- **Notifications**: `NotificationsService` is now the one place that writes to the previously-unused
  `Notification` table (`RecordingsEventsService`'s `RECORDING_READY` row is routed through it too) —
  every write also pushes a live `NOTIFICATION_CREATED` event, backing a real topbar bell with an unread
  count instead of only ever showing up on next page load.
- **Search**: a real `GET /search` endpoint over the caller's own meetings/notes/contacts — no fake
  results, no cross-user leakage.
- **Apps**: framed honestly as a launcher for this app's own real features (Classes, Recordings, Notes,
  Team Chat, Contacts) — explicitly *not* a third-party integration marketplace, since no external app
  integrations exist here to install.

**Two genuine, previously-undiscovered bugs found by testing this with two real separate browser sessions**
(everything before this stage had only ever been verified by one user acting alone, which never exercised
delivery *to a second person*):

- **`RealtimeBroadcastService.publish` only ever worked for meeting rooms.** It rebuilds the Socket.IO room
  name by splitting the Redis channel string on `":"` and keeping the last segment, then always prefixes
  `meeting:` — so a personal notification published as `user:{id}` silently landed nowhere a client was
  listening. Fixed by adding a parallel `publishToRoom` path (`realtime-broadcast.service.ts`) that carries
  the exact target room in the message body instead of trying to reconstruct it from the channel name.
- **A waiting-room participant could never receive their own admit event.** `RealtimeGateway.onJoinMeeting`
  correctly refuses to let a `WAITING` participant's socket join the meeting's Socket.IO room (they're not
  admitted yet) — but `ParticipantsService.admit` broadcast `WAITING_ROOM_ADMIT` *only* to that same room,
  which the participant being admitted was, by construction, never in. Fixed by also delivering it to the
  admitted participant's personal `user:{id}` room (reliable regardless of meeting-room membership),
  keeping the meeting-room broadcast as a secondary signal. Reproduced and confirmed fixed with two real
  logged-in sessions: host creates a meeting, second user requests to join, lands in `WAITING`, host clicks
  Admit, second user's browser transitions into the live meeting with no manual reload.

## Definition of Done — core meeting loop (Stage 1-4 target)

```
Register → Login → Create Meeting → Get Meeting Link → Open second session
  → Join Meeting → Camera + Microphone → Two-way Audio/Video → Participant List
  → Chat → Screen Share → Host Controls → Leave Meeting → Meeting Ends
```

## Definition of Done — classroom loop (Stage 6 target)

```
Teacher creates class → Students join → Teacher starts class → Students appear
  → Attendance tracked → Screen share → Whiteboard → Poll → Quiz → Recording
  → Class ends → Attendance + recording available
```

The entire loop, including recording, is implemented and real (not mocked): class CRUD + enrollment
(`apps/api/src/classes`), a class session is just a `Meeting` of type `CLASS` reusing the entire
meeting engine (join flow, roles, LiveKit tokens — see `MeetingsService.join`'s class-role resolution),
attendance is derived from actual LiveKit webhook presence events (`AttendanceService.recompute`, unit
tested in `attendance.service.spec.ts`), the whiteboard is a real synced canvas
(`apps/web/src/components/meeting/classroom/whiteboard-canvas.tsx`), polls/quizzes are live with
real-time results/leaderboards, and recording uses LiveKit's real Egress service (see Stage 7 below).

**Known Stage 6 simplifications** (honest, not hidden — see also `apps/mobile/README.md` for the mobile
gap): attendance is computed on-demand via a "Recompute" button rather than automatically the instant a
class session ends (a scheduled job that calls the same `AttendanceService.recompute` on `room_finished`
webhook receipt is a natural, small follow-up); the classroom tools panel (whiteboard/polls/quiz/breakout)
is available in every meeting, not gated to `type: CLASS`, which is a deliberate feature-parity choice (a
regular meeting host can run a poll too) rather than an oversight; there is no mobile classroom UI yet.

## Recording (Stage 7)

Real LiveKit Egress integration, not a stub: `POST /meetings/:id/recordings/start` requests a
`RoomCompositeEgress` job, status transitions (`RECORDING` → `PROCESSING` → `READY`/`FAILED`) arrive via
LiveKit's `egress_*` webhooks (`RecordingsEventsService`), playback is a short-lived presigned S3/MinIO
URL (`StorageService`, never raw credentials to the client), and a daily cron job enforces a 90-day
retention window (`RecordingsCleanupService`). Full architecture: `docs/webrtc.md` §Recording.

**Verified end-to-end for real**: ran the actual `livekit/egress` worker (headless Chrome + FFmpeg,
`infrastructure/docker/egress.yaml`) against a live meeting — started a recording from the web UI, watched
`RECORDING` → `PROCESSING` → `READY` happen for real, confirmed the MP4 landed in MinIO (`mc ls`), and
played it back through a presigned URL in an actual `<video>` element. This exercise caught and fixed two
real bugs that unit tests couldn't have caught, since both are only observable with a live egress worker
and a real webhook round-trip:

- **LiveKit's egress webhooks were silently rejected.** LiveKit posts webhooks with
  `Content-Type: application/webhook+json`, not `application/json` — NestJS's default body parser (even
  with `rawBody: true`) only captures `req.rawBody` for the exact `application/json` type, so every
  webhook (not just egress ones — participant join/leave too) was hitting `LiveKitWebhookController`'s
  "missing signature" guard and returning 400, invisibly. No recording could ever leave `PROCESSING`.
  Fixed in `apps/api/src/main.ts` via `app.useBodyParser("json", { type: [...] })` to accept both types.
- **The recordings panel never learned a recording finished.** `RecordingsEventsService` updated the DB
  row on every webhook but never broadcast anything — `RECORDING_STARTED`/`STOPPED` only cover the
  user-initiated edges of the lifecycle, so a client had to close and reopen the panel to see `READY`.
  Added a `RECORDING_UPDATED` WS event broadcast on every webhook-driven status change; the panel now
  updates live.

This exercise also confirmed why `livekit-server` needs the `redis:` block already present in
`infrastructure/docker/livekit.yaml`: without it, `livekit-server` has no way to hand an egress job to a
worker, and `EgressClient.startRoomCompositeEgress()` just hangs until the caller's HTTP client times out
rather than failing fast. (The sandbox used to verify this ran each service as a standalone container
instead of via `docker compose`, so this had to be reproduced by hand once — worth calling out for anyone
doing the same, since it's easy to copy `egress.yaml` alone and miss that `livekit.yaml` needs this too.)

## Admin dashboard (Stage 9)

Gated end-to-end by `systemRole: ADMIN` (`SystemAdminGuard` on every `/admin/*` API route — see
`docs/security.md`; the web app's `/admin` layout redirects non-admins as a UX nicety on top of that, not
instead of it). `pnpm db:seed` creates `admin@arutech.dev` / `Password123!` for local testing.

Implemented, backed by real queries (no placeholder numbers) — see `docs/api.md` §Admin:

- **Dashboard stats**: total users, active sessions (30-day proxy for active users — see the caveat the
  endpoint itself returns in its `notes` field), organizations, meetings today, live meetings now, classes
  today, recording count/total storage.
- **System health**: Postgres connectivity, API process uptime/memory, recent recording failures.
- **Users**: search, suspend (also revokes all of that user's active sessions immediately, not just a
  future-login block) / reactivate.
- **Organizations, Meetings, Classes, Recordings**: read-only listing tables.
- **Audit Logs**: reads from a previously-unused `audit_logs` table — nothing wrote to it before this
  stage. Now populated for participant removal, co-host promotion, recording deletion, and admin user
  suspend/activate (`AuditLogService`, deliberately wired into a handful of genuinely privileged actions
  rather than every request, which would just be noise).

## Production infrastructure (Stage 10)

- **Observability**: structured JSON logging (pino, secrets redacted), a Prometheus `/metrics` endpoint
  with real domain metrics (not just default process stats), an OpenTelemetry tracing bootstrap, and
  Sentry error tracking — all real code, but the OTel/Sentry paths are opt-in (env-var gated) and were not
  exercised against a live collector/Sentry project here. See `docs/deployment.md` §Environment.
- **NGINX**: `infrastructure/nginx/nginx.conf` — validated for real with `nginx -t` (twice: once
  confirming the syntax parses, once with dummy `--add-host` entries confirming the full config, including
  upstream resolution, is valid).
- **Kubernetes/Helm**: a real chart (`infrastructure/kubernetes/helm/arutech-meet`) — `helm lint` and
  `helm template` both run for real, output structurally validated. Not validated: an actual `kubectl
  apply`/`helm install` against a live cluster (none available here).
- **Terraform**: `infrastructure/terraform/` (AWS reference: VPC, EKS, RDS, ElastiCache, S3) —
  `terraform validate` run for real against every module and the root configuration (all pass). Not
  validated: `terraform plan`/`apply` against a real AWS account (none available here).
- **CI/CD**: `.github/workflows/ci.yml` gained a `docker-build` job (actually builds both production
  images + Trivy-scans them on every PR) and a `deploy` job shape for main — the latter's registry
  push/helm-upgrade steps are commented-out placeholders needing real credentials.

**Why this stage is marked done rather than "written but unverified"**: unlike some earlier
architecture-only pieces in this roadmap, every artifact above was run through its own real validator
(`nginx -t`, `helm lint`/`template`, `terraform validate`, an actual `docker build` + container boot
against real Postgres/Redis — see the Stage 10 commits) rather than only reviewed by eye. That process is
also what found and fixed four genuine production-breaking bugs (see `docs/deployment.md` §Containers) —
concrete evidence the verification was real, not just present.

**Deliberately not built**: bandwidth/packet-loss/jitter figures (need the Stage 10 observability stack,
not just a DB query — the dashboard says so explicitly rather than showing a fake number), a dedicated
"Reports" export UI, and an Abuse/Security moderation queue beyond what Users/suspend already covers.

