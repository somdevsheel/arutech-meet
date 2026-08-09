# WebRTC / Media Architecture

## Topology

```
Browser/Mobile client
     │  WebRTC (DTLS-SRTP)
     ▼
LiveKit SFU  ◄──── server API (RoomServiceClient, WebhookReceiver) ──── apps/api
     │
     ▼
Recording Egress (Stage 7) → Object Storage
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
