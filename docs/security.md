# Security

## Authentication

- Passwords hashed with **Argon2id** (`argon2` npm package, server default parameters).
- Access tokens: JWT, 15 min default (`JWT_ACCESS_EXPIRES_IN`), carry `sub`, `email`, `systemRole`,
  `sessionId`. Verified on every request by `JwtAuthGuard` (`apps/api/src/common/guards/jwt-auth.guard.ts`)
  — the only place a request becomes "authenticated".
- Refresh tokens: JWT, 30 day default, but authority is the **hashed copy stored in `sessions`** — a
  refresh token is only honored if `sha256(token)` matches `sessions.refreshTokenHash` for a
  non-revoked, non-expired session row. This means refresh tokens are revocable server-side even though
  they are self-contained JWTs.
- **Rotation + reuse detection**: every successful refresh issues a new refresh token and overwrites the
  stored hash. If a client ever presents a refresh token whose hash does not match what's currently
  stored (replay of an already-rotated token, or a forged token), the session is immediately revoked —
  see `AuthService.refresh` and the reuse-detection tests in `apps/api/src/auth/auth.service.spec.ts`.
- Prepared (not yet wired to a live provider) for Google/Microsoft/Apple OAuth and enterprise SSO via the
  `auth_identities` table — each is a `(provider, providerAccountId)` pair linked to a `users` row.

## Authorization

- **Platform-level**: `users.systemRole` (`USER`/`ADMIN`) — gates the entire `/admin/*` API surface via
  `SystemAdminGuard` (`apps/api/src/common/guards/system-admin.guard.ts`), checked against the
  `systemRole` claim embedded in the access token at login (see Authentication above — a role change
  takes effect on that user's next token refresh, not instantly). This is a distinct, separate concept
  from org-level `ADMIN` below: platform admin is "can use the Arutech Meet admin dashboard", org admin is
  "can manage members within one specific organization". A user can be one, both, or neither.
- **Org-level**: `memberships.role` (`OWNER`/`ADMIN`/`MEMBER`) — org membership/billing management scoped
  to that organization only.
- **Meeting-level**: `meeting_participants.role` against the capability matrix in
  `packages/types/src/permissions.ts` (`CAPABILITIES`, `ROLE_CAPABILITIES`, `can()`). This is the single
  definition of "what can role X do" — see `docs/architecture.md` §6.
- `apps/api/src/meetings/permission.service.ts` is the only place that resolves a capability decision: it
  loads the caller's role from the database by `(meetingId, userId)` and never trusts a role claimed by
  the client. Every mutating meetings/participants/chat endpoint and every privileged WebSocket handler
  goes through it (`requireCapability` / `requireOwnerOrCapability`).
- The frontend imports the same `can()` function purely to decide what UI to render (hide a button a user
  can't use). This is convenience only — a forged request without the capability is rejected server-side
  regardless of what the client showed.
- LiveKit-side enforcement: moderator actions (mute, remove, promote) call LiveKit's server API
  (`RoomServiceClient`) so the SFU itself stops the media, not just the UI. Promoted roles get a
  `roomAdmin` grant applied immediately via `updateParticipantPermissions`, not just on next token
  issuance.

## Audit trail

`audit_logs` is written by a single service (`AuditLogService`, `apps/api/src/audit/audit-log.service.ts`)
called from the handful of actions that actually matter for a security review, not every request (which
would just be noise an attacker's real action gets lost in): participant removal, co-host promotion,
recording deletion, and admin-initiated user suspend/activate. Readable via `GET /admin/audit-logs`
(platform-admin only). Extending coverage to more actions means calling `AuditLogService.record()` from
that action's service, not building a second logging mechanism.

## Transport & headers

- `helmet()` for standard security headers.
- CORS restricted to `CORS_ORIGINS` (comma-separated allow-list), `credentials: true`.
- Cookie parsing configured with a signing secret (`COOKIE_SECRET`) for future HttpOnly-cookie session
  storage — see the note in `apps/web/src/lib/auth-store.ts` about moving the refresh token out of
  localStorage into an HttpOnly cookie as a hardening follow-up.
- Global rate limiting via `@nestjs/throttler` (`RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX`), with a stricter
  per-route limit on `POST /auth/login` (5/min) to slow credential stuffing.

## Input validation

- Every REST body/query is validated against a Zod schema from `@arutech/validation` via
  `ZodValidationPipe` — the same schemas are importable by the web client for pre-submit validation, so
  the rules are defined once. Unknown/extra fields are rejected by Zod's default `.parse()` behavior for
  object schemas built with `z.object()` (strict members only, no passthrough).
- WebSocket message payloads are validated the same way (`sendChatMessageSchema.parse(...)` in the
  gateway) before being persisted or broadcast.

## Meeting-specific protections

- Optional per-meeting password, Argon2-hashed, checked server-side before a token is ever issued.
- Waiting room: participants land in `WAITING` status and get **no LiveKit token** until a host/co-host
  explicitly admits them (`ParticipantsService.admit`) — a participant cannot obtain media access by
  guessing/forging a token because none was issued.
- Meeting lock (`lockAfterStart`): once live, new (non-existing) participants are rejected.
- LiveKit tokens are short-lived (10 minutes) and room-scoped (`roomJoin` grant tied to one
  `livekitRoomName`), minted only after the above checks pass.

## File uploads (architecture — see docs/roadmap.md Stage 7 for the worker implementation)

- Clients never receive S3/MinIO credentials — only short-lived signed URLs minted by the API.
- Planned validation pipeline: size limit → MIME allow-list → virus scan (`virusScanStatus` on `files`,
  `PENDING` until a scanning worker clears it) → only then is a file considered downloadable by other
  participants.

## What is deliberately NOT claimed

Standard WebRTC/DTLS-SRTP transport encryption (client ↔ LiveKit) and TLS (client ↔ API) are in place,
but **this is not application-level end-to-end encryption**: the LiveKit SFU has access to decrypted
media (it must, to route/transcode/record), and so does any recording/transcription pipeline built on top
of it. See `docs/webrtc.md` §"End-to-end encryption" for what a future E2EE mode would and would not
cover, and do not describe the current system as E2EE in product copy.
