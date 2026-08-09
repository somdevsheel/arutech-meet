# Realtime (WebSocket) Architecture

Two independent realtime channels exist; do not conflate them:

1. **WebRTC media** (client ↔ LiveKit SFU directly) — see `docs/webrtc.md`.
2. **App-level realtime channel** (client ↔ `apps/api`'s Socket.IO gateway) — chat, presence,
   hand-raise, waiting-room admit/deny, moderation fan-out, and (future) whiteboard/poll/quiz sync. This
   document covers #2.

## Connection & auth

`RealtimeGateway` (`apps/api/src/realtime/realtime.gateway.ts`) requires a valid access token in the
Socket.IO handshake (`auth.token`) — verified with the same `TokenService` used by REST's `JwtAuthGuard`.
An invalid/missing token gets an `error` event and an immediate disconnect; there is no unauthenticated
realtime access. (Guest — non-account — participants therefore do not currently get chat/presence; they
still get full media access via LiveKit, since that authorization is separate and password/waiting-room
gated. See `docs/roadmap.md` for closing this gap with a scoped guest realtime token.)

## Rooms

Each meeting maps to a Socket.IO room `meeting:{meetingId}`. `meeting:join` (`WS_EVENTS.JOIN_MEETING`)
re-validates that the caller has an `ADMITTED`/`JOINED` `MeetingParticipant` row (via
`PermissionService.getParticipant`) before allowing `socket.join()` — a socket cannot listen to a
meeting's events without already being an authorized participant of it.

## Horizontal scaling

Two distinct mechanisms, both Redis-backed, serve different purposes:

1. **Socket.IO Redis adapter** (`@socket.io/redis-adapter`) — makes `server.to(room).emit()` reach
   sockets connected to *any* gateway instance, not just the instance that called `.emit()`. Wired in
   `RealtimeGateway.afterInit`.
2. **RealtimeBroadcastService** (`apps/api/src/realtime/realtime-broadcast.service.ts`) — lets REST
   controllers/services (which are not inside the gateway process/module) trigger a broadcast without a
   direct dependency on the gateway. It publishes `{event, payload}` JSON to a
   `{REDIS_PREFIX}:meeting:{meetingId}` channel; `RealtimeGateway` maintains a dedicated `psubscribe`
   connection that relays anything published there into the matching Socket.IO room. This is how, e.g., a
   REST call to `POST /meetings/:id/participants/:id/admit` ends up as a `waiting_room:admit` event on the
   admitted participant's socket, without `MeetingsModule` importing `RealtimeModule` (avoiding a circular
   module dependency — see the comment in `apps/api/src/meetings/permission.module.ts`).

Any API/gateway instance can therefore trigger a realtime event that reaches a client connected to any
other instance — no critical realtime state lives only in one process's memory.

## Chat persistence

Chat messages are persisted synchronously before being broadcast (`ChatService.persistMessage` is called
from the gateway's `chat:message` handler before `server.to(room).emit(...)`), so a client that
reconnects and calls `GET /meetings/:id/chat/messages` sees history that is never out of sync with what
was actually broadcast.

## Event catalog

See `packages/types/src/websocket-events.ts` (`WS_EVENTS`) for the authoritative list of event names and
their payload shapes — imported by both `apps/api` and `apps/web` so client/server never drift.
