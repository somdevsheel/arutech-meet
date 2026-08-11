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
| 7 | Recording: egress worker, S3/MinIO storage, playback | ⏳ Schema + interfaces done, worker pending |
| 8 | AI assistant: transcription pipeline, summary/action items, pluggable provider | ⏳ Schema + interfaces done, pipeline pending |
| 9 | Admin dashboard | ⏳ Not started |
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

Everything up to "Quiz" is implemented and real (not mocked): class CRUD + enrollment
(`apps/api/src/classes`), a class session is just a `Meeting` of type `CLASS` reusing the entire
meeting engine (join flow, roles, LiveKit tokens — see `MeetingsService.join`'s class-role resolution),
attendance is derived from actual LiveKit webhook presence events (`AttendanceService.recompute`, unit
tested in `attendance.service.spec.ts`), the whiteboard is a real synced canvas
(`apps/web/src/components/meeting/classroom/whiteboard-canvas.tsx`), and polls/quizzes are live with
real-time results/leaderboards. "Recording" is Stage 7 (not yet built) — a class can run its full loop
today without it, attendance/whiteboard/polls/quizzes just won't have a recording alongside them yet.

**Known Stage 6 simplifications** (honest, not hidden — see also `apps/mobile/README.md` for the mobile
gap): attendance is computed on-demand via a "Recompute" button rather than automatically the instant a
class session ends (a scheduled job that calls the same `AttendanceService.recompute` on `room_finished`
webhook receipt is a natural, small follow-up); the classroom tools panel (whiteboard/polls/quiz/breakout)
is available in every meeting, not gated to `type: CLASS`, which is a deliberate feature-parity choice (a
regular meeting host can run a poll too) rather than an oversight; there is no mobile classroom UI yet.

