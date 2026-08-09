# Implementation Roadmap

Tracks staged delivery per `docs/architecture.md`. Update the status column as work lands.

| Stage | Scope | Status |
|---|---|---|
| 1 | Monorepo, TS/lint/format config, env files | ✅ Done |
| 2 | Backend foundation: Postgres, Prisma schema, Redis, auth (JWT + refresh rotation), users, orgs, RBAC | ✅ Done |
| 3 | Meeting engine: meeting CRUD, join flow, LiveKit token service, WebSocket gateway (chat/presence/moderation), participant management | 🔶 In progress |
| 4 | Meeting UI (web): lobby/pre-join, meeting room, participant grid, controls, chat panel, screen share | 🔶 In progress |
| 5 | Mobile (React Native): auth, meeting list, join, A/V, push notifications | ⏳ Not started |
| 6 | Classroom: classes, attendance, whiteboard, polls, quizzes, breakout rooms | ⏳ Schema done, UI/API pending |
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

