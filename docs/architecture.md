# Arutech Meet — System Architecture

Owner: Arutech Consultancy Services LLP
Status: Living document, updated as implementation progresses.

## 1. Goals

Arutech Meet is a multi-tenant SaaS platform providing:

1. **Meetings** — ad-hoc and scheduled video/audio meetings with screen share, chat, recording.
2. **Online Classrooms** — teacher/student sessions with attendance, whiteboard, polls, quizzes, breakout rooms.
3. **Calls** — 1:1 and group voice/video calling with call history and push notifications.

Design targets: thousands of concurrent meetings, horizontal scalability, defense-in-depth security,
and a media pipeline that never routes raw audio/video through the application API tier.

## 2. High-level topology

```
                          Cloud Load Balancer
                                 │
                               NGINX
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
             Web               API (N)          WebSocket GW (N)
         (Next.js)           (NestJS REST)     (NestJS + Socket.IO,
                                                 Redis adapter)
              │                  │                  │
              └──────────────────┼──────────────────┘
                                 │
                    PostgreSQL (primary)  +  Redis (cache/pubsub/presence)
                                 │
                            Media Layer
                                 │
                          LiveKit SFU Cluster
                                 │
                       Recording Workers (egress)
                                 │
                          Object Storage (S3/MinIO)
```

The application backend (NestJS) is the **source of truth and authority**: authentication, meeting
lifecycle, participant authorization, RBAC, scheduling, chat persistence, and issuing short-lived
LiveKit access tokens. It never proxies media.

The **media layer** (LiveKit, an SFU) is the only component that touches raw audio/video/screen-share
RTP. Clients connect to LiveKit directly over WebRTC using a token minted by the API after the API has
authorized the participant for that specific room.

## 3. Why an SFU (LiveKit) instead of P2P mesh

A mesh topology requires every participant to upload/decode N-1 streams, which does not scale past a
handful of participants and offers no server-side recording/composition hook. An SFU:

- Each client uploads once; the SFU fans out to other participants (with simulcast, so it can forward
  the appropriate resolution/bitrate to each downstream client based on their network conditions).
- Enables recording/egress, server-side composition, and future features (transcription, AI capture)
  without every client re-encoding.
- Scales horizontally — rooms are distributed across SFU nodes; a session-affinity/routing layer keeps
  all participants of one room on one SFU node (LiveKit handles this internally in its cluster mode).

**LiveKit vs mediasoup**: both are legitimate. We chose **LiveKit** because it ships a complete server
(Go, single deployable binary/container, horizontally scalable via its own Redis-backed node
coordination), first-class client SDKs (`livekit-client`, React Native SDK), built-in simulcast/adaptive
streaming, and a built-in Egress service for recording/composition — which materially reduces the amount
of custom media-plane code we must operate and secure, without giving up self-hosting or control. Should
requirements later demand custom media processing that LiveKit cannot express, the abstraction boundary
(`MediaService` in the API, described below) is narrow enough to swap in a mediasoup-backed
implementation.

## 4. Service boundaries

| Service | Responsibility | Owns state? |
|---|---|---|
| `apps/api` (NestJS) | Auth, users, orgs, RBAC, meetings, classes, chat persistence, scheduling, notifications, admin, LiveKit token issuance, webhook ingestion from LiveKit | PostgreSQL (source of truth) |
| WebSocket Gateway (within `apps/api`, horizontally scaled) | Chat delivery, presence, whiteboard sync, poll/quiz live updates, waiting-room events | Redis (pub/sub across instances) |
| LiveKit SFU | Media routing, simulcast, active-speaker detection, room state | In-memory + its own Redis coordination |
| `services/recording` (Egress worker) | Consumes LiveKit Egress webhooks/output, finalizes recordings, writes metadata | PostgreSQL (recording metadata), S3 (media) |
| `services/transcription` | Pulls recording audio, calls STT provider, produces transcript + AI summary via pluggable `AiProvider` | PostgreSQL |
| `apps/web` (Next.js) | Web client | — |
| `apps/mobile` (React Native) | iOS/Android client | — |
| `apps/admin` | Admin dashboard (can also be a protected route set inside `apps/web`) | — |

## 5. Authentication & session model

- Argon2id password hashing.
- JWT access token (short-lived, ~15 min) + rotating refresh token (long-lived, stored hashed in
  `sessions`, one row per device/session so a user can view/revoke sessions individually).
- Refresh rotation: each refresh consumes the old token and issues a new one; reuse of a consumed token
  revokes the whole session family (breach detection).
- WebSocket connections authenticate with the same access token (sent during the Socket.IO handshake),
  validated server-side before the socket joins any room.
- OAuth (Google/Microsoft/Apple) and enterprise SSO are modeled as additional `identities` rows linked to
  a `user`, behind a common `AuthProvider` interface — see `docs/security.md`.

## 6. Authorization model

Centralized, backend-enforced RBAC. Two layers:

1. **Org-level role** (`OWNER`, `ADMIN`, `MEMBER`, …) via `memberships` — controls org/admin-dashboard
   access, billing, policy configuration.
2. **Meeting/class-level role** (`HOST`, `CO_HOST`, `TEACHER`, `STUDENT`, `PARTICIPANT`, `GUEST`) via
   `meeting_participants` — controls in-room capabilities (mute others, remove participant, manage
   recording, etc.)

A single `packages/validation`-adjacent `PermissionService` (in `apps/api`) is the only place permission
decisions are computed; both REST controllers and the WebSocket gateway call into it via Nest guards. The
frontend reflects permissions the API already granted (e.g. hides a button) but **never** decides them —
every mutating action is re-checked server-side. See `docs/security.md` §"Authorization".

## 7. Realtime signaling

- WebRTC session negotiation (SDP/ICE) happens directly between client and LiveKit — the app backend is
  not a signaling relay for media.
- The app-level WebSocket channel (Socket.IO, Redis adapter for multi-instance fan-out) carries:
  chat messages, typing indicators, hand-raise, waiting-room admit/deny, whiteboard operations, poll/quiz
  broadcast, participant-list deltas, and moderation actions (mute/remove) which are then also reflected
  into LiveKit via server-to-server LiveKit API calls (so the SFU is the enforcement point for actually
  cutting a participant's media, not just a UI hint).

## 8. Data architecture

PostgreSQL is the single source of truth (see `docs/database.md` for full schema). Redis is used only
for ephemeral/derived state: sessions cache, presence, waiting-room queues, distributed locks (e.g. "only
one worker starts egress for a room"), rate limiting counters, and Socket.IO's cross-instance adapter.
Redis is never the durable store for anything that must survive a flush.

## 9. Multi-tenancy

Every meeting/class/recording/file belongs either to an individual user (`ownerId`) or to an
`organization`. `organizations` carries plan/limits (storage quota, concurrent-meeting quota, branding).
Row-level checks in the API (not RLS in this phase) enforce tenant isolation; `docs/database.md` documents
the composite indexes used to keep those checks index-backed.

## 10. Scalability posture

- `apps/api` is stateless (JWT auth, no in-memory session) → scale horizontally behind NGINX/LB.
- WebSocket layer uses the Socket.IO Redis adapter so any gateway instance can deliver to a client
  connected to any other instance.
- LiveKit runs in cluster mode (Redis-backed node coordination) so rooms distribute across SFU nodes.
- Recording/transcription run as separate worker processes consuming queues (Redis-backed in dev, can move
  to a managed queue in production) so a slow/failed egress never blocks the meeting.
- No critical state lives only in a single process's memory.

## 11. What is explicitly out of scope for the first implementation slice

This is a large system; see `docs/roadmap.md` for staged delivery. The first working slice (Stage 1-4)
delivers the full "Definition of Done" loop from `docs/roadmap.md`: register → login → create meeting →
join from a second session → two-way audio/video via LiveKit → chat → screen share → host controls →
leave/end. Classroom, recording pipeline, AI assistant, and mobile app are architected (interfaces + DB
schema exist now) and implemented in subsequent stages tracked in the roadmap.
