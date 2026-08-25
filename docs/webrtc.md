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

## AI meeting assistant

Post-meeting pipeline: `MeetingRecording` (READY) → ffmpeg audio extraction → speech-to-text →
LLM summarization → `MeetingTranscript` / `TranscriptSegment` / `AiSummary`. Implemented in
`apps/api/src/ai` (`TranscriptsService`, `TranscriptsController` at `meetings/:id/transcripts`).

- **Provider-agnostic by construction, not just by intent.** `TranscriptsService` depends only on the
  `TranscriptionProvider` / `SummarizationProvider` interfaces (`apps/api/src/ai/providers/`), injected via
  DI tokens that `AiProviderModule` resolves from env vars (`TRANSCRIPTION_PROVIDER`, `AI_PROVIDER` — see
  `packages/config/src/env.ts`), independently of each other. The only concrete implementation today is
  OpenAI (`whisper-1` for speech-to-text, `gpt-4o-mini` with Structured Outputs for summarization); adding
  a self-hosted model or another vendor is implementing those two interfaces and adding a case to that
  factory — `TranscriptsService` doesn't change. With no `OPENAI_API_KEY` configured, `NullTranscription/
  SummarizationProvider` are selected and requests fail with a clear `503`, never a fake transcript.
- **The API process downloads and processes the recording itself** (`StorageService.downloadToFile` →
  ffmpeg `-f segment` splits it into fixed 15-minute mono 16kHz/64kbps audio chunks, well under the
  Whisper API's 25MB-per-request limit regardless of meeting length) — this doesn't violate the "no raw
  media through the app server" rule for *live* calls (§Topology above), since this runs entirely after
  the meeting has ended, against a file already sitting in S3/MinIO, the same way a recording itself is
  batch-processed rather than proxied live.
- **Known v1 architectural simplification, documented rather than hidden**: the pipeline runs in-process,
  fire-and-forget, on whichever API instance received the `POST .../transcripts` request — correct and
  non-blocking for one instance, but not yet safe across multiple horizontally-scaled API replicas (a
  crash mid-pipeline leaves the transcript stuck `PROCESSING`, and there's no cross-instance concurrency
  limit). See the doc comment on `TranscriptsService` for the documented follow-up: a dedicated worker
  (mirroring the egress worker's separate-process shape) claiming `PENDING` rows, or a real queue
  (BullMQ on the existing Redis) — the provider interfaces are already agnostic to where they're called
  from.
- **Status transitions** (`PENDING` → `PROCESSING` → `READY`/`FAILED`) broadcast over
  `WS_EVENTS.TRANSCRIPT_UPDATED`, the same pattern as `RECORDING_UPDATED`, plus a `TRANSCRIPT_READY`
  notification through `NotificationsService` on completion.
- **No speaker diarization from `whisper-1`** — OpenAI's classic transcription API doesn't separate
  speakers, so `TranscriptSegment.speakerLabel` is `null` for the OpenAI provider today.
  `gpt-4o-transcribe-diarize` (`response_format: "diarized_json"`) supports real per-speaker labels and is
  a documented upgrade path once broadly available, with no interface change needed.
- **Not live-verified against a real OpenAI account** (no API key available while building this) — unlike
  Stage 7's recording pipeline, which was run against a live egress worker. What *was* verified for real:
  the exact ffmpeg extraction/chunking command was run against a synthesized real test video and its
  output confirmed via `ffprobe` to be valid decodable mono 16kHz audio, correctly split into multiple
  chunks; the full pipeline (permissions, state machine, error handling) is covered by
  `apps/api/src/ai/transcripts.service.spec.ts` with the provider boundary mocked.

## Live captions

Architecturally distinct from the AI meeting assistant above, not an extension of it — that pipeline is
*batch* (a finished recording file, processed after the meeting ends); this one is *streaming* (audio
while the meeting is happening). Implemented as a real **LiveKit Agents worker**,
`services/transcription/src/agent.ts` — a genuinely separate process type from anything else in this repo
(the closest precedent, egress recording, is an external LiveKit-provided container, not custom code
here), explicitly dispatched into a meeting's room (`CaptionsService.start` →
`LiveKitService.startCaptions` → `AgentDispatchClient.createDispatch`) when a host clicks the toolbar's
"Captions" button — never automatic for every meeting, the same "real infra cost, so opt-in" reasoning
recording already has.

- **One STT stream per remote participant, not one per room.** `@livekit/agents`' higher-level
  `AgentSession`/`RoomIO` stack is built around one agent linked to *one* participant (a voice-assistant
  shape — `RoomInputOptions.participantIdentity` defaults to "link to the first participant" if unset),
  wrong for a meeting where anyone can speak. The agent instead uses the lower-level `Room`/`STT`
  primitives directly: on every `TrackSubscribed` audio track, it opens its own `SpeechStream`, pumps that
  participant's real audio frames into it, and publishes each interim/final segment back to the room via
  `LocalParticipant.publishTranscription`, **attributed to the speaking participant's own LiveKit
  identity** — not the agent's. That's LiveKit's own native room-transcription protocol (not a custom
  event on this app's Socket.IO gateway), read client-side via `@livekit/components-react`'s
  `useTranscriptions()` (`caption-bar.tsx`) — the same "reuse the media engine's own primitives" principle
  Stage 4's virtual background followed with `@livekit/track-processors`.
- **STT provider**: `@livekit/agents-plugin-openai`'s `STT`, which uses OpenAI's Realtime transcription
  WebSocket API (streaming), a different product from Stage 8's `whisper-1` REST call — genuinely
  real-time, not chunked-and-polled. Falls back to nothing if `OPENAI_API_KEY` is unset: the agent
  explicitly refuses to start captioning and shuts the job down with a clear log reason, rather than
  silently producing empty captions — same "fail loudly, never fabricate" convention as
  `NullTranscriptionProvider`.
- **Bot participant, filtered out of the UI.** The agent connects with a fixed identity
  (`CAPTIONS_AGENT_IDENTITY`, `@arutech/types`) rather than a framework-generated one, so both
  `LiveKitService`'s dispatch call and the web client's video-grid filter agree on the exact same string.
  It never publishes camera/mic, but LiveKit component hooks default to placeholder tiles for every
  participant regardless — `video-grid.tsx` explicitly excludes this one identity so it never gets an
  empty tile, and it was never wired into `ParticipantsPanel` at all (that panel is driven by this app's
  own `MeetingParticipant` roster via the real `join()` REST flow, which the bot never goes through).
- **A real environment limitation found and worked around, not swept under a schema change**:
  `AgentDispatchClient.listDispatch(roomName)` — the LiveKit server API this app would naturally use to
  ask "is captioning currently on for this room?" — was found, live, to not reliably scope by room against
  this LiveKit server build: a brand-new room that never had a dispatch still came back with an active
  dispatch, its `room` field simply echoing back whatever name was queried. `createDispatch`/
  `deleteDispatch` (by an exact, already-known dispatch id) were confirmed working correctly, so
  `LiveKitService` tracks the one active dispatch id per room itself in Redis (`captions:dispatch:
  {roomName}`, this app's existing ephemeral-state store) instead of trusting that read call — see
  `LiveKitService.captionsActive`'s own doc comment for the full story.
- **Not persisted.** Live captions are ephemeral, matching the roadmap's own scoping — a downloadable
  transcript already exists post-meeting via Stage 8's pipeline; this is purely "read the words on screen
  while it's happening."
- **Multilingual, structurally**: every `TranscriptionSegment` carries its own `language` field (LiveKit's
  wire type), populated from whatever the STT plugin reports — no hardcoded English assumption baked into
  the transport, even though only one caption language is surfaced in the UI today.
- **Not live-verified against real caption text** — no `OPENAI_API_KEY` was available in this session's
  environment, the same gap Stage 8 hit. What *was* verified for real: the worker genuinely registers with
  LiveKit, accepts a real host-triggered dispatch, joins the exact target meeting's room over real WebRTC,
  and — the part that matters — the whole rest of the feature around it (host-only control gating, the
  live broadcast telling every participant captions are on, the bot never appearing as a video tile,
  clean start/stop with no state leaking across meetings) was verified live with two real browser sessions.
  See `docs/roadmap.md`'s Live captions stage for that evidence.

## End-to-end encryption

Not implemented. Documented honestly rather than mischaracterized:

- Current state: DTLS-SRTP encrypts media between client and LiveKit, and TLS encrypts API/WebSocket
  traffic. This protects against network eavesdropping but **the LiveKit server itself can access
  decrypted media** (required to route/forward it, and would be required to record or transcribe it).
- A true E2EE mode (e.g. LiveKit's optional frame-level E2EE using `insertable streams`) would need:
  keys exchanged out-of-band of the SFU, all participants on E2EE-capable clients, and — critically —
  **recording and server-side transcription/AI features (§AI meeting assistant above) would not be able
  to operate on E2EE'd meetings**, since both require the media (or its audio) to be visible to a
  server-side process. A product using
  E2EE would need to disable recording/transcription for those meetings or run those features
  client-side only.
- This is scoped as future work; the architecture does not block adding it (LiveKit supports it), but it
  is off by default and off in this implementation.
