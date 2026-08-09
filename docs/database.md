# Database

Source of truth: [`packages/database/prisma/schema.prisma`](../packages/database/prisma/schema.prisma).
This document is a narrative index — read the schema file for exact fields/types.

## Conventions

- Primary keys: `uuid` (`@default(uuid())`), generated app-side by Postgres-compatible UUID.
- All tables have `createdAt`; mutable tables have `updatedAt`; tables holding user content that must
  support recovery/audit use soft deletion (`deletedAt`) instead of hard `DELETE` — `users`,
  `organizations`, `meetings`, `classes`, `files`, `meeting_recordings`.
- Foreign keys use `onDelete: Cascade` where the child record has no meaning without the parent (e.g.
  `meeting_participants` → `meetings`), and `SetNull`/no action where the child should survive (e.g. a
  chat message survives its sender's account deletion, shown as "deleted user").
- Every table that is queried scoped to a meeting/org has a composite index covering that scope
  (`meetingId, status`, `orgId, createdAt`, etc.) — see `@@index` blocks in the schema.

## Entity groups

1. **Identity & access** — `users`, `auth_identities` (OAuth/SSO), `sessions` (refresh-token/device
   sessions, supports per-device revocation), `devices` (push tokens).
2. **Multi-tenancy** — `organizations`, `memberships` (org role + member type), `subscriptions` (plan,
   billing provider references — one of `orgId`/`userId` set, enforced at the application layer since
   Postgres has no native "exactly one of two nullable FKs" constraint).
3. **Meetings** — `meetings`, `meeting_settings` (1:1 toggles), `meeting_participants` (role + status +
   the `livekitIdentity` used to authorize that participant's LiveKit token), `meeting_invites`,
   `meeting_events` (append-only; join/leave/mute/etc. — this is what attendance is computed from),
   `meeting_recordings`, `meeting_transcripts` + `transcript_segments` + `ai_summaries`.
4. **Chat** — `chat_rooms` (polymorphic: meeting / class / direct / group), `chat_members`,
   `chat_messages` (supports reply-to and private in-meeting DMs via `isPrivate`/`toUserId`),
   `chat_reactions`, `chat_attachments` → `files`.
5. **Calls** — `calls`, `call_participants`. Calls reuse the same `livekitRoomName` mechanism as
   meetings — see `docs/webrtc.md` §"Calls share the meeting media engine".
6. **Classroom** — `classes`, `class_teachers`, `class_students`, `class_sessions` (each session is a
   1:1 wrapper around a `meetings` row so classes reuse the full meeting engine), `attendance`.
7. **Whiteboard** — `whiteboards` → `whiteboard_pages` (each page stores a serialized scene graph as
   `Json`; realtime sync is WebSocket-delivered ops, periodically checkpointed into this column — see
   `docs/realtime.md`).
8. **Polls & quizzes** — `polls`/`poll_options`/`poll_responses`,
   `quizzes`/`quiz_questions`/`quiz_options`/`quiz_answers`.
9. **Breakout rooms** — `breakout_rooms` (each is its own LiveKit room) + `breakout_room_assignments`.
10. **Notifications** — `notifications` (channel-tagged: push/email/in-app).
11. **Files** — `files` (`storageKey` is the only pointer into object storage; clients never see bucket
    credentials, only signed URLs minted by the API — see `docs/security.md`).
12. **Audit** — `audit_logs` (actor, action, target, metadata; written for every privileged
    action — role changes, recording deletion, participant removal, billing changes).

## Attendance computation

`attendance` rows are derived (by a backend job triggered on `class_session` end) from the
`meeting_events` of type `JOIN`/`LEAVE` for that session's `meetingId`: duration is the sum of
join→leave intervals, `rejoinCount` counts additional `JOIN` events after the first, and `status` is
`PRESENT` (duration ≥ 80% of session length), `PARTIAL` (attended but below threshold), or `ABSENT` (no
join event) — threshold configurable per class in a later iteration.

## Migrations

Run from repo root: `pnpm db:migrate` (dev) / `pnpm --filter @arutech/database exec prisma migrate deploy`
(CI/production). Never hand-edit generated migration SQL for a migration that has already shipped to a
shared environment — create a new migration instead.
