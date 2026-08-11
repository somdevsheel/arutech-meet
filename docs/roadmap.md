# Implementation Roadmap

Tracks staged delivery per `docs/architecture.md`. Update the status column as work lands.

| Stage | Scope | Status |
|---|---|---|
| 1 | Monorepo, TS/lint/format config, env files | ✅ Done |
| 2 | Backend foundation: Postgres, Prisma schema, Redis, auth (JWT + refresh rotation), users, orgs, RBAC | ✅ Done |
| 3 | Meeting engine: meeting CRUD, join flow, LiveKit token service, WebSocket gateway (chat/presence/moderation), participant management | ✅ Done |
| 4 | Meeting UI (web): lobby/pre-join, meeting room, participant grid, controls, chat panel, screen share | ✅ Done |
| 5 | Mobile (React Native): auth, meeting list, join, A/V, push notifications | 🔶 Core loop done (see apps/mobile/README.md for gaps: no live pre-join preview, no waiting-room live-admit, no screen share, push notifications architecture-only) |
| 6 | Classroom: classes, attendance, whiteboard, polls, quizzes, breakout rooms | ✅ Backend + web UI done (mobile classroom UI not yet built — see apps/mobile/README.md) |
| 7 | Recording: egress worker, S3/MinIO storage, playback | ✅ Backend + web UI done (real LiveKit Egress integration; not end-to-end verified in this environment — see docs/webrtc.md §Recording) |
| 8 | AI assistant: transcription pipeline, summary/action items, pluggable provider | ⏸️ Deliberately deferred (user decision) — schema (`meeting_transcripts`, `transcript_segments`, `ai_summaries`) and the "pluggable `AiProvider`, don't hardcode one vendor" architectural intent are in place; no pipeline code yet. Revisit as a future upgrade. |
| 9 | Admin dashboard | ✅ Backend + web UI done — Users, Organizations, Meetings, Classes, Recordings, Audit Logs, dashboard stats, system health. "Reports" and a dedicated Abuse/Security moderation queue are not built (see note below); admin has no dedicated mobile UI. |
| 10 | Production infra: k8s/Helm, Terraform, CI/CD, observability wiring | ⏳ Docker Compose done, rest pending |

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

**Not verified end-to-end in this environment**: Egress requires a separate worker service running
headless Chrome + FFmpeg (`infrastructure/docker/egress.yaml`, the `egress` service in
`docker-compose.yml`), which this sandbox cannot run. The integration code follows LiveKit's documented
API exactly and the business logic (guard against double-recording, disabled-recording setting, download
only once `READY`) is unit tested (`recordings.service.spec.ts`), but actually starting a recording,
watching it land in MinIO, and playing it back has not been exercised here — that's the natural next
verification step, e.g. via `docker compose up`.

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

**Deliberately not built**: bandwidth/packet-loss/jitter figures (need the Stage 10 observability stack,
not just a DB query — the dashboard says so explicitly rather than showing a fake number), a dedicated
"Reports" export UI, and an Abuse/Security moderation queue beyond what Users/suspend already covers.

