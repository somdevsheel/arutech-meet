# WebRTC / Media Architecture

## Topology

```
Browser/Mobile client
     │  WebRTC (DTLS-SRTP)
     ▼
LiveKit SFU  ◄──── server API (RoomServiceClient, EgressClient, WebhookReceiver) ──── apps/api
     │                                    │
     │ (Redis-coordinated job dispatch)   │ (job request only — API is never in this path)
     ▼                                    ▼
Egress worker (separate container/service, headless Chrome + FFmpeg)
     │
     ▼
S3 / MinIO  ──(egress_* webhooks)──▶ apps/api (RecordingsEventsService) ──▶ Postgres
```

The Node.js API (`apps/api`) is never in the media path. It:

1. Authorizes a participant for a specific room and mints a short-lived, room-scoped LiveKit access
   token (`LiveKitService.createRoomToken`, `apps/api/src/livekit/livekit.service.ts`).
2. Issues moderation commands to LiveKit's server API (mute a track, remove a participant, change grants)
   — enforced at the SFU, not just reflected in the UI.
3. Receives signed webhooks from LiveKit (`participant_joined`, `participant_left`, `room_finished`, …)
   to keep PostgreSQL in sync with what actually happened in the room
   (`MeetingsEventsService.handleLiveKitWebhook`).

The client connects **directly** to the LiveKit SFU over WebRTC using the token from step 1
(`@livekit/components-react`'s `<LiveKitRoom serverUrl={LIVEKIT_URL} token={token} connect />` in
`apps/web/src/components/meeting/meeting-room.tsx`). SDP/ICE negotiation happens entirely between the
browser and LiveKit; the app backend is not a signaling relay for media.

## Why not P2P mesh

See `docs/architecture.md` §3. Short version: mesh cost is O(N²) uplink/downlink for N participants and
has no server-side hook for recording; an SFU is O(N) per participant and centralizes exactly the things
this product needs (simulcast, recording, future transcription).

## Simulcast & adaptive streaming

Camera tracks are published with LiveKit's default simulcast layers; the SFU forwards the layer
appropriate to each subscriber's measured bandwidth automatically. This is LiveKit's built-in behavior —
the application does not implement bitrate adaptation itself, it configures grants/room settings and lets
the SFU do the adaptive work it is designed for.

## Screen sharing

Screen share is a second published track (`Track.Source.ScreenShare`, optionally
`ScreenShareAudio`) through the same LiveKit connection — not a separate mechanism. Whether a
participant's token grants `canPublishSources` including `SCREEN_SHARE` is decided server-side from the
meeting's `screenShareScope` setting (`HOST_ONLY` vs `ALL_PARTICIPANTS`) at token-issuance time
(`MeetingsService.issueToken`).

## Calls share the meeting media engine

1:1 and group calls (`calls`/`call_participants` tables) use the exact same LiveKit room + token
mechanism as scheduled meetings — a `Call` row just has a different lifecycle (ringing → ongoing → ended)
around the same `livekitRoomName` concept. There is intentionally only one media engine in this codebase.

## Network quality (architecture; UI wiring tracked in the roadmap)

LiveKit's client SDK exposes per-participant connection quality (`ConnectionQuality`) and track-level
stats (RTT, jitter, packet loss, bitrate) via `Room`/`Participant` events. The intended mapping:

```
Excellent / Good / Fair / Poor / Reconnecting  ← LiveKit ConnectionQuality + Room connection state
```

Audio is prioritized over video under constrained bandwidth: LiveKit's SFU degrades/drops video
simulcast layers before it will drop audio, consistent with the product requirement in
`docs/roadmap.md`. The graceful-degradation UI (explicit "reduce quality" indicator, forced video-off
suggestion) is not yet built — tracked in the roadmap under classroom/meeting UI polish.

## Reconnection

`@livekit/components-react`'s `<LiveKitRoom>` handles WebRTC-level reconnection (ICE restart / renegotiate)
internally. The app-level WebSocket (chat/presence/moderation) reconnects independently via Socket.IO's
built-in reconnection (`apps/web/src/lib/socket.ts`) and re-runs `meeting:join` on `connect` so presence
state is rebuilt after a network blip — see `docs/realtime.md`.

## Recording

Implemented via LiveKit's **Egress** service — a room-composite recording (headless Chrome renders the
same kind of layout a viewer would see, FFmpeg encodes it) uploaded directly from the egress worker to
S3/MinIO. This is a deliberate reuse of infrastructure the SFU vendor already built and operates well,
rather than a custom capture pipeline; it also means the API process is never in the recording's data
path, matching the "no raw media through the app server" rule for live calls.

- **Egress is a separate service from `livekit-server`** (own container/process: `livekit/egress`,
  see `infrastructure/docker/egress.yaml` and the `egress` service in `docker-compose.yml`). It talks to
  `livekit-server` via Redis, not directly — `infrastructure/docker/livekit.yaml`'s `redis:` block exists
  specifically for this; without it, `startRoomRecording` calls queue with no worker able to claim them.
- `LiveKitService.startRoomRecording` (`apps/api/src/livekit/livekit.service.ts`) requests a
  `RoomCompositeEgress` job and gets back an `egressId` — nothing about the recording's actual progress is
  known synchronously. `RecordingsService.start` persists a `RECORDING`-status row keyed by that
  `egressId` and returns immediately.
- Recording state transitions (`RECORDING` → `PROCESSING` → `READY`/`FAILED`) happen entirely via LiveKit's
  `egress_started`/`egress_updated`/`egress_ended` webhooks, handled by
  `RecordingsEventsService.handleEgressUpdate` (`apps/api/src/recordings/recordings-events.service.ts`) —
  the same signed-webhook path as participant join/leave events, see `LiveKitWebhookController`.
- **Playback never exposes S3 credentials to the client.** `GET /meetings/:id/recordings/:id/download`
  returns a short-lived (10 min) presigned URL, generated by `StorageService`
  (`apps/api/src/storage/storage.service.ts`) — see `docs/security.md`.
- **Two different S3 endpoints, on purpose.** The egress worker and the API's own server-to-server calls
  (delete) use the Docker-internal endpoint (`S3_ENDPOINT`, e.g. `http://minio:9000`); presigned URLs
  handed to a browser are signed against a separately-configurable, publicly-reachable endpoint
  (`S3_PUBLIC_ENDPOINT`, e.g. `http://localhost:9000`) — see the comment in `packages/config/src/env.ts`.
  Getting this wrong produces presigned URLs a browser can never actually resolve; it's easy to miss
  because everything else about the request would succeed.
- **Expiration**: `MeetingRecording.expiresAt` is set 90 days out at creation;
  `RecordingsCleanupService` (a daily `@Cron` job) deletes the S3 object and marks the row `DELETED` once
  past that date — the same effect a manual delete has, just time-triggered. See `docs/roadmap.md`.
- **Verified end-to-end**: ran the real `livekit/egress` worker against a live meeting, watched
  `RECORDING` → `PROCESSING` → `READY` happen for real, confirmed the MP4 in MinIO, and played it back via
  a presigned URL. Found and fixed two real bugs in the process — see `docs/roadmap.md` §Recording for
  both. The `FileInfo.duration` unit (nanoseconds, assumed from LiveKit's Go implementation) is now
  confirmed correct against a real recording (an ~8s capture reported as 6 real seconds of actual
  recorded content, not off by a factor of 1e6/1e9 the way a unit mistake would show up).

## End-to-end encryption

Not implemented. Documented honestly rather than mischaracterized:

- Current state: DTLS-SRTP encrypts media between client and LiveKit, and TLS encrypts API/WebSocket
  traffic. This protects against network eavesdropping but **the LiveKit server itself can access
  decrypted media** (required to route/forward it, and would be required to record or transcribe it).
- A true E2EE mode (e.g. LiveKit's optional frame-level E2EE using `insertable streams`) would need:
  keys exchanged out-of-band of the SFU, all participants on E2EE-capable clients, and — critically —
  **recording and server-side transcription/AI features would not be able to operate on E2EE'd meetings**,
  since both require the media (or its audio) to be visible to a server-side process. A product using
  E2EE would need to disable recording/transcription for those meetings or run those features
  client-side only.
- This is scoped as future work; the architecture does not block adding it (LiveKit supports it), but it
  is off by default and off in this implementation.
