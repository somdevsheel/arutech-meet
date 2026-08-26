# Implementation Roadmap

Tracks staged delivery per `docs/architecture.md`. Update the status column as work lands.

| Stage | Scope | Status |
|---|---|---|
| 1 | Monorepo, TS/lint/format config, env files | ✅ Done |
| 2 | Backend foundation: Postgres, Prisma schema, Redis, auth (JWT + refresh rotation), users, orgs, RBAC | ✅ Done |
| 3 | Meeting engine: meeting CRUD, join flow, LiveKit token service, WebSocket gateway (chat/presence/moderation), participant management | ✅ Done |
| 4 | Meeting UI (web): lobby/pre-join, meeting room, participant grid, controls, chat panel, screen share | ✅ Done |
| 5 | Mobile (React Native): auth, meeting list, join, A/V, push notifications | 🔶 Core loop + live pre-join camera preview + live waiting-room admit + Android screen share all real (see apps/mobile/README.md) — remaining gaps: no iOS screen share (needs an Xcode-only Broadcast Upload Extension target), push notifications architecture-only, iOS not build-verified (no macOS/Xcode available here) |
| 6 | Classroom: classes, attendance, whiteboard, polls, quizzes, breakout rooms | ✅ Backend + web UI done (mobile classroom UI not yet built — see apps/mobile/README.md) |
| 7 | Recording: egress worker, S3/MinIO storage, playback | ✅ Done — real LiveKit Egress integration, verified end-to-end for real (started a recording, watched it reach `READY`, confirmed the MP4 in MinIO, played it back) — see docs/roadmap.md §Recording and docs/webrtc.md §Recording |
| 8 | AI assistant: transcription pipeline, summary/action items, pluggable provider | ✅ Real pipeline (OpenAI whisper-1 + gpt-4o-mini structured outputs) behind a provider-agnostic interface, wired into the recordings panel web UI — see notes below. Not yet live-verified against a real OpenAI account (no key available while building); no mobile UI; runs in-process rather than on a dedicated worker (documented v1 simplification, see below). |
| 9 | Admin dashboard | ✅ Backend + web UI done — Users, Organizations, Meetings, Classes, Recordings, Audit Logs, dashboard stats, system health. "Reports" and a dedicated Abuse/Security moderation queue are not built (see note below); admin has no dedicated mobile UI. |
| 10 | Production infra: k8s/Helm, Terraform, CI/CD, observability wiring | ✅ Done — see notes below |
| 11 | Home UI redesign + Team Chat, Contacts, Notes, personal meeting room, notifications, search, Apps launcher | ✅ Done — see notes below |
| 12 | Advanced features Priority 1 (video view modes/pin/fullscreen/PiP, reactions, raise hand, participant live-state) | ✅ Done, live-verified with two real browser sessions — see notes below. Full gap analysis against the entire 50-section advanced-features brief: `docs/feature-gap-analysis.md`; staged plan for everything not yet built: `docs/advanced-features-roadmap.md`. |
| 13 | Advanced features Priority 1, continued: meeting chat rewrite (reply, reactions, file/image attachments, private DM, delete, link/@mention rendering) | ✅ Done, live-verified with two real browser sessions including a real image upload — see notes below. |
| 14 | Virtual background (blur, image presets, custom upload) | ✅ Done, live-verified — real MediaPipe segmentation via `@livekit/track-processors`, not a CSS trick. Not yet in the pre-join lobby (toolbar only). See notes below. |
| 15 | Calls: real ring/accept/reject/busy/cancel/missed, call history | ✅ Done, live-verified end-to-end with two real users through the full state machine — found and fixed two real bugs in the process (a client-side socket singleton bug, a call-ending data-integrity bug). See notes below. |

## Home UI redesign + new workspace features (Stage 11)

Prompted by a UI mockup the user wanted matched pixel-for-pixel; several of its elements (Team Chat,
Contacts, Notes, Apps, a persistent "personal meeting room") had no backend at all, so this stage built
real ones rather than static chrome — see the per-feature notes below. One deliberate exception: the
mockup's meeting-room pill read "End-to-end encrypted", which contradicts this app's own documented
security model (`docs/security.md`, `docs/webrtc.md` §"End-to-end encryption") — it's labeled "Encrypted"
instead, matching what's actually true (DTLS-SRTP/TLS transport encryption, not E2EE).

- **Personal meeting room**: `GET /meetings/personal` lazily creates (once) and forever reuses a
  standing `Meeting` per user (`Meeting.isPersonalRoom`) — same code every time, waiting room off. Required
  teaching `MeetingsEventsService`'s `room_finished` handler not to flip a personal room's status to
  `ENDED` the way a normal meeting does, or the owner would be permanently locked out after their first session.
- **Contacts**: derived entirely from real `MeetingParticipant` history (`ContactsService.list`) — everyone
  the caller has actually shared a `JOINED`/`LEFT` meeting with, no separate address book to maintain.
  "Call" creates a real instant meeting via the same `MeetingsService.create` the rest of the app uses and
  pushes the callee a real notification; "Message" opens/reuses a real `DIRECT` chat room. Deliberately
  *not* full ring/accept/decline calling — the `Call`/`CallParticipant` schema exists for that but has no
  service built around it yet, documented as a scoping decision in `ContactsService.call`, not hidden.
- **Team Chat**: reuses the existing `ChatRoom`/`ChatMember`/`ChatMessage` tables (previously wired only
  for meeting-scoped chat) for standing `GROUP`/`DIRECT` rooms, with real read receipts
  (`ChatMember.lastReadMessageId`) driving the unread badges — not a client-side-only "seen" flag.
- **Notes**: a new `Note` model, plain CRUD, private to their owner, optionally linked to a meeting.
- **Notifications**: `NotificationsService` is now the one place that writes to the previously-unused
  `Notification` table (`RecordingsEventsService`'s `RECORDING_READY` row is routed through it too) —
  every write also pushes a live `NOTIFICATION_CREATED` event, backing a real topbar bell with an unread
  count instead of only ever showing up on next page load.
- **Search**: a real `GET /search` endpoint over the caller's own meetings/notes/contacts — no fake
  results, no cross-user leakage.
- **Apps**: framed honestly as a launcher for this app's own real features (Classes, Recordings, Notes,
  Team Chat, Contacts) — explicitly *not* a third-party integration marketplace, since no external app
  integrations exist here to install.

**Two genuine, previously-undiscovered bugs found by testing this with two real separate browser sessions**
(everything before this stage had only ever been verified by one user acting alone, which never exercised
delivery *to a second person*):

- **`RealtimeBroadcastService.publish` only ever worked for meeting rooms.** It rebuilds the Socket.IO room
  name by splitting the Redis channel string on `":"` and keeping the last segment, then always prefixes
  `meeting:` — so a personal notification published as `user:{id}` silently landed nowhere a client was
  listening. Fixed by adding a parallel `publishToRoom` path (`realtime-broadcast.service.ts`) that carries
  the exact target room in the message body instead of trying to reconstruct it from the channel name.
- **A waiting-room participant could never receive their own admit event.** `RealtimeGateway.onJoinMeeting`
  correctly refuses to let a `WAITING` participant's socket join the meeting's Socket.IO room (they're not
  admitted yet) — but `ParticipantsService.admit` broadcast `WAITING_ROOM_ADMIT` *only* to that same room,
  which the participant being admitted was, by construction, never in. Fixed by also delivering it to the
  admitted participant's personal `user:{id}` room (reliable regardless of meeting-room membership),
  keeping the meeting-room broadcast as a secondary signal. Reproduced and confirmed fixed with two real
  logged-in sessions: host creates a meeting, second user requests to join, lands in `WAITING`, host clicks
  Admit, second user's browser transitions into the live meeting with no manual reload.

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

**Verified end-to-end for real**: ran the actual `livekit/egress` worker (headless Chrome + FFmpeg,
`infrastructure/docker/egress.yaml`) against a live meeting — started a recording from the web UI, watched
`RECORDING` → `PROCESSING` → `READY` happen for real, confirmed the MP4 landed in MinIO (`mc ls`), and
played it back through a presigned URL in an actual `<video>` element. This exercise caught and fixed two
real bugs that unit tests couldn't have caught, since both are only observable with a live egress worker
and a real webhook round-trip:

- **LiveKit's egress webhooks were silently rejected.** LiveKit posts webhooks with
  `Content-Type: application/webhook+json`, not `application/json` — NestJS's default body parser (even
  with `rawBody: true`) only captures `req.rawBody` for the exact `application/json` type, so every
  webhook (not just egress ones — participant join/leave too) was hitting `LiveKitWebhookController`'s
  "missing signature" guard and returning 400, invisibly. No recording could ever leave `PROCESSING`.
  Fixed in `apps/api/src/main.ts` via `app.useBodyParser("json", { type: [...] })` to accept both types.
- **The recordings panel never learned a recording finished.** `RecordingsEventsService` updated the DB
  row on every webhook but never broadcast anything — `RECORDING_STARTED`/`STOPPED` only cover the
  user-initiated edges of the lifecycle, so a client had to close and reopen the panel to see `READY`.
  Added a `RECORDING_UPDATED` WS event broadcast on every webhook-driven status change; the panel now
  updates live.

This exercise also confirmed why `livekit-server` needs the `redis:` block already present in
`infrastructure/docker/livekit.yaml`: without it, `livekit-server` has no way to hand an egress job to a
worker, and `EgressClient.startRoomCompositeEgress()` just hangs until the caller's HTTP client times out
rather than failing fast. (The sandbox used to verify this ran each service as a standalone container
instead of via `docker compose`, so this had to be reproduced by hand once — worth calling out for anyone
doing the same, since it's easy to copy `egress.yaml` alone and miss that `livekit.yaml` needs this too.)

## AI meeting assistant (Stage 8)

Full architecture and trade-offs: `docs/webrtc.md` §AI meeting assistant, API surface: `docs/api.md` §AI
meeting assistant. Summary: a real pipeline (`apps/api/src/ai`) turns a `READY` `MeetingRecording` into a
timestamped transcript and an AI-generated summary — key points, action items (with owner when stated),
decisions, questions, and chapter segments — surfaced live in the recordings panel via a "Generate
transcript & AI summary" action and `WS_EVENTS.TRANSCRIPT_UPDATED`.

**Genuinely pluggable, not just described as such**: `TranscriptsService` depends only on
`TranscriptionProvider`/`SummarizationProvider` interfaces (`apps/api/src/ai/providers/`), resolved from
the `TRANSCRIPTION_PROVIDER`/`AI_PROVIDER` env vars by `AiProviderModule`. The only concrete
implementation today is OpenAI (whisper-1 for speech-to-text, gpt-4o-mini with Structured Outputs for
summarization); with no `OPENAI_API_KEY` set, a `NullProvider` pair is selected instead and requests fail
with an explicit 503 — never a fabricated transcript.

**Known Stage 8 simplifications, stated honestly**:

- **In-process, fire-and-forget, not yet a dedicated worker.** `TranscriptsService.process()` runs on
  whichever API instance received the trigger request — correct and non-blocking for a single instance,
  but not yet safe across multiple horizontally-scaled replicas (a crash mid-pipeline leaves a transcript
  stuck `PROCESSING` forever). The natural follow-up, a queue-backed worker mirroring the egress worker's
  separate-process shape, needs no change to the provider interfaces themselves.
- **Not live-verified against a real OpenAI account** — no API key was available while building this,
  unlike Stage 7's recording pipeline, which was run end-to-end against a live egress worker. What *was*
  verified for real instead: the exact ffmpeg audio-extraction/chunking command
  (`TranscriptsService.extractAudioChunks`) was run against a synthesized real test video (not a mock) and
  its output confirmed via `ffprobe` to be valid, decodable, correctly-split mono 16kHz audio — the part of
  this pipeline most likely to have a shape bug that unit tests (which mock the provider boundary) can't
  catch. The rest of the pipeline (permission checks, state machine, error handling, duplicate-generation
  guards) is covered by `apps/api/src/ai/transcripts.service.spec.ts`.
- **No speaker diarization** — `whisper-1` doesn't separate speakers, so every segment from the OpenAI
  provider has `speakerLabel: null` today. `gpt-4o-transcribe-diarize` supports real per-speaker labels and
  is a documented upgrade path (see `docs/webrtc.md`) with no interface change required.
- **No mobile UI** — the recordings panel's transcript/summary view is web-only; `apps/mobile` has no
  equivalent yet, consistent with that app's other documented gaps (`apps/mobile/README.md`).

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

## Production infrastructure (Stage 10)

- **Observability**: structured JSON logging (pino, secrets redacted), a Prometheus `/metrics` endpoint
  with real domain metrics (not just default process stats), an OpenTelemetry tracing bootstrap, and
  Sentry error tracking — all real code, but the OTel/Sentry paths are opt-in (env-var gated) and were not
  exercised against a live collector/Sentry project here. See `docs/deployment.md` §Environment.
- **NGINX**: `infrastructure/nginx/nginx.conf` — validated for real with `nginx -t` (twice: once
  confirming the syntax parses, once with dummy `--add-host` entries confirming the full config, including
  upstream resolution, is valid).
- **Kubernetes/Helm**: a real chart (`infrastructure/kubernetes/helm/arutech-meet`) — `helm lint` and
  `helm template` both run for real, output structurally validated. Not validated: an actual `kubectl
  apply`/`helm install` against a live cluster (none available here).
- **Terraform**: `infrastructure/terraform/` (AWS reference: VPC, EKS, RDS, ElastiCache, S3) —
  `terraform validate` run for real against every module and the root configuration (all pass). Not
  validated: `terraform plan`/`apply` against a real AWS account (none available here).
- **CI/CD**: `.github/workflows/ci.yml` gained a `docker-build` job (actually builds both production
  images + Trivy-scans them on every PR) and a `deploy` job shape for main — the latter's registry
  push/helm-upgrade steps are commented-out placeholders needing real credentials.

**Why this stage is marked done rather than "written but unverified"**: unlike some earlier
architecture-only pieces in this roadmap, every artifact above was run through its own real validator
(`nginx -t`, `helm lint`/`template`, `terraform validate`, an actual `docker build` + container boot
against real Postgres/Redis — see the Stage 10 commits) rather than only reviewed by eye. That process is
also what found and fixed four genuine production-breaking bugs (see `docs/deployment.md` §Containers) —
concrete evidence the verification was real, not just present.

**Deliberately not built**: bandwidth/packet-loss/jitter figures (need the Stage 10 observability stack,
not just a DB query — the dashboard says so explicitly rather than showing a fake number), a dedicated
"Reports" export UI, and an Abuse/Security moderation queue beyond what Users/suspend already covers.

## Advanced features, Priority 1 (Stage 12)

Prompted by a 50-section "make this competitive with Zoom/Meet/Teams" brief. `docs/feature-gap-analysis.md`
audits every one of those 50 sections against what actually exists (most of Priority 1-2 already did — see
that doc for the evidence); this stage is what was net-new or fixed. `docs/advanced-features-roadmap.md`
sequences everything still open.

- **Video grid rebuilt off LiveKit's stock components.** `GridLayout`/`ParticipantTile` (the vendor
  prefabs) gave zero control over view modes, pinning, or per-tile fullscreen/PiP — `video-grid.tsx` and
  the new `video-tile.tsx` render tracks directly via `useTracks`/`VideoTrack`/`ConnectionQualityIndicator`
  instead, adding real Gallery/Speaker view switching, multi-participant pin (a screen share always
  spotlights regardless of mode; pin takes precedence over Speaker's auto-selected active speaker), a
  hide-non-video-participants toggle, and whole-grid + per-tile fullscreen/Picture-in-Picture. Bundle size
  was checked, not assumed: the `/meeting/[code]` route actually got *smaller* (178kB → 175kB First Load
  JS) replacing the prefabs with direct primitive usage.
- **Raise hand fixed from entirely dead code.** Before this stage, `useMeetingSocket`'s `raiseHand()`
  callback existed but nothing in `meeting-toolbar.tsx`/`meeting-room.tsx` ever called it, and no client
  ever listened for `WS_EVENTS.HAND_RAISE`/`HAND_LOWER` to update anything — confirmed by grep, not
  assumption, before touching it. Now: a real toolbar toggle, state derived from the server-broadcast
  presence list (not local-only, so a host force-lowering someone's hand actually updates their button),
  sorts to the top of the participants panel with a ✋ badge, and a host `Lower hand` action gated behind
  the `participant.mute` capability (`RealtimeGateway.onHandLower`, `targetUserId` param).
- **Emoji reactions** (👏👍❤️😂🎉😕🙌): a new `WS_EVENTS.REACTION`, ephemeral like hand-raise (broadcast
  only, never persisted, validated server-side against a fixed emoji set so the channel can't be used to
  broadcast arbitrary strings), rendered as floating emoji over the video area with CSS-keyframe animation
  (`globals.css`'s `.reaction-float`, not styled-jsx — kept consistent with this app's existing
  plain-Tailwind-plus-global-CSS convention rather than introducing a new styling pattern).
- **Participants panel now shows live state.** `ParticipantPresencePayload.micEnabled`/`cameraEnabled`/
  `isScreenSharing`/`handRaised` were already broadcast over the wire and simply never rendered — the panel
  was effectively a name list. Now renders all four plus a host "Lower hand" action.

**Two real bugs found and fixed by actually driving this with two browsers, not by code review alone**
(`.run-driver/drive-two-person.js` — registers two real users in two independent browser contexts with
fake camera devices, gets both into the same meeting including a real waiting-room admit, and exercises
every new control; screenshots in `.run-driver/screenshots/two-person/`):

- **A focus tile's own hover controls (pin/PiP/fullscreen) were unclickable.** Both the grid-level view-mode
  controls and a large focus tile's per-tile controls anchored to the same `absolute right-2 top-2` corner;
  Playwright's click reported the grid controls "intercepting pointer events" at that location — a real
  z-index/layout collision a human would have hit immediately trying to pin someone in Speaker view. Fixed
  by giving the grid-level controls a real row in normal document flow instead of floating them over the
  video, rather than a z-index escalation that would only have deferred the same class of bug.
- **A participant who joined after others saw an empty-ish Participants panel.**
  `RealtimeGateway.onJoinMeeting` only ever broadcast the newly-joining participant's own presence to the
  room — it never sent the joiner a snapshot of who was already there. LiveKit's own video tiles were
  unaffected (the SFU has its own roster, separate from this app-level presence channel), which is exactly
  why this was easy to miss without a live two-person test: the video grid looked completely correct while
  the Participants panel silently lied. Fixed by stashing each socket's last-broadcast presence on
  `SocketData` and replaying every existing room member's presence to a client the moment it joins
  (`RealtimeGateway.SocketData.presence`, cross-instance-safe via the existing Redis-adapter
  `fetchSockets()`, which this codebase already uses for horizontal WS scaling). Verified fixed with the
  same two-browser driver: the joiner's panel went from "Participants (1)" (only themselves) to correctly
  showing both participants, roles, and the host's already-raised hand.

**Verification infrastructure note**: this required a real, independent LiveKit + Redis + Postgres stack
to test against without disturbing whatever was already running in this environment (a separate,
production-shaped deployment, unrelated to this stage's work) — spun up on non-conflicting ports, torn
down (dev servers stopped; a couple of scratch Docker containers could not be removed due to a sandbox
permission restriction on `docker stop`/`kill`, left running but fully isolated and harmless). Worth a
`/run-skill-generator` pass to capture this as a reusable project skill, since it took real trial and error
(LiveKit `--dev` mode's default UDP port didn't match the first port range published to the host, caught by
actually reading the container's startup log rather than assuming the ports lined up).

## Advanced features, Priority 1 continued: meeting chat rewrite (Stage 13)

`chat-panel.tsx` was previously a bare send/receive box — reply, private DM, reactions, and attachments all
had real schema/most of the API already in place (see `docs/feature-gap-analysis.md` §5's pre-rewrite
notes) but nothing in the UI used any of it, and message deletion, file attachments, link/@mention
rendering, and timestamps didn't exist anywhere at all. This stage built all of it for real:

- **Reply**: quoted-message preview above the composer; the rendered quote re-resolves live if the quoted
  message is later deleted (shows "(deleted)"), rather than freezing stale text — verified live.
- **Reactions**: a real `ChatService.toggleReaction` (unique on messageId+userId+emoji, same pattern as the
  schema already enforced), broadcast over the previously-declared-but-unused `WS_EVENTS.CHAT_REACTION`
  constant, grouped-by-emoji pills with counts, highlighted when the viewer is one of the reactors.
- **File/image attachments — real, not stubbed.** Built a genuine `FilesService`/`FilesController`
  (`apps/api/src/files`) on the previously-completely-unused `FileAsset` schema: the client asks for a
  presigned upload URL (server-enforced MIME allowlist + size cap first), uploads directly to S3/MinIO
  (never through the API process — same "no raw media/files through the app server" principle the SFU
  architecture already follows for live audio/video), then sends a chat message referencing the resulting
  `fileId`. Images render inline via a freshly-signed short-lived download URL; other files render as a
  download button. `virusScanStatus` is modeled and checked (blocks `INFECTED`) but honestly documented as
  unenforceable today — no scanner is wired up, so everything sits at `PENDING` forever, which the guard
  treats as downloadable rather than hanging the feature on a scan that will never run.
- **Private DM UI**: a recipient picker ("To: Everyone ▾" / a specific participant) — the backend
  (`isPrivate`/`toUserId`, gateway routing to only the two sockets) already existed and needed no changes.
- **Message deletion**: soft-delete (own message needs no permission check; someone else's requires
  `chat.delete_any_message`, audit-logged like every other privileged moderation action), broadcasts live
  over a new `WS_EVENTS.CHAT_MESSAGE_DELETED` so it disappears for every open panel immediately.
- **Link detection and @mention highlighting**: client-side, and deliberately never
  `dangerouslySetInnerHTML` — message text is tokenized into plain-text/URL/mention segments and each
  rendered as its own React node, so there's no HTML-injection surface regardless of what a participant
  types.
- **A real, previously-invisible gap fixed in passing**: chat history was never actually fetched on
  joining a meeting — `useMeetingSocket`'s `messages` state only ever grew via live WS events, so joining
  an in-progress meeting (or reloading the page) showed *only* messages sent after that moment. Now fetched
  once via the existing (already-built, simply never-called) `GET /meetings/:id/chat/messages` on mount.

**Verified live with two real registered users and zero console errors** on either side
(`.run-driver/drive-chat-features.js`, screenshots in `.run-driver/screenshots/chat-features/`): sent a
message with a real link and mention, replied to it, reacted to the reply, uploaded a real PNG and watched
it arrive and render inline on the other participant's screen, sent a private message and confirmed it
only appeared correctly labeled for the two of them, and deleted a message and confirmed both the
placeholder and the now-stale reply-quote updated live.

**Two verification-environment gaps this exposed, not app bugs** (both fixed before concluding
verification, worth recording so they don't look like silent gaps if re-encountered): the isolated
verification stack from Stage 12 never had MinIO provisioned (nothing before this stage needed object
storage to demonstrate), so the first upload attempt failed at the network level (`Failed to fetch`) — a
MinIO container was added and a bucket created. Separately, running `pnpm build` against the web app while
its `next dev` server was concurrently serving the live demo corrupted the shared `.next` directory
(`next build` and `next dev` cannot safely share one `.next` folder) — recovered by stopping the dev
server, clearing `.next`, and restarting it; production-build verification for the remainder of this stage
relied on typecheck/lint/tests plus the live driver instead of a repeated `pnpm build` against a running
dev server.

## Virtual background (Stage 14)

Real, not a fake overlay: `@livekit/track-processors` (LiveKit's own first-party package, MediaPipe selfie
segmentation via WebGL/WASM) plugs directly into the actual published `LocalVideoTrack` via
`setProcessor()`/`switchTo()` — every other participant receives the composited frame exactly as rendered,
same as the local preview. `use-virtual-background.ts` owns one lazily-created processor instance reused
across selections (the package's documented pattern, avoiding a visual glitch and a repeated model-load
cost that constructing a fresh processor per toggle would cause); `virtual-background-panel.tsx` is the
popover UI off a new toolbar "Background" button — None / Blur / four generated gradient presets (no
licensed photography available to this build, so honestly abstract rather than pretending to be stock
office/nature photos) / a custom local upload via `URL.createObjectURL` (client-side only, explicitly not
persisted or synced across devices — the panel says so).

**Verified live, and the verification method matters here more than usual**: for a feature like this,
confirming the UI *toggles* proves nothing about whether real segmentation is running — a fake
implementation could flip the same buttons and change nothing. The actual test
(`.run-driver/drive-virtual-background.js`) compares screenshots before/after each selection: Blur visibly
softened the edges of the synthetic camera test pattern (Chrome's `--use-fake-device-for-media-stream`
output) while the flat background stayed flat, and the Ocean preset fully replaced the entire frame with
the generated gradient — both are only possible if MediaPipe's segmenter actually ran against real frame
data and the compositor actually wrote new pixels into the published track. Zero console errors.

**One real operational incident during this stage, not an app bug**: the web dev server crashed with a
V8 heap OOM shortly after `pnpm install` pulled in `@mediapipe/tasks-vision` (a sizeable new dependency)
and webpack tried to compile it under the dev server's default heap limit. Recovered by restarting with
`NODE_OPTIONS=--max-old-space-size=4096`; worth carrying that env var into this app's `dev`/production
start scripts proactively rather than waiting to hit the same ceiling again, especially given the
`.next` corruption incident from Stage 13 — this dev server has now had two unplanned restarts in one
session from unrelated causes, which is worth a look if a third happens.

**Not yet built**: pre-join lobby integration (still LiveKit's stock `<PreJoin>` prefab, which doesn't
expose its internal video track for a processor the way the custom in-meeting toolbar does — the same
kind of "replace the stock component for control" work `video-grid.tsx` already did in Stage 12, not yet
applied here). Background removal (a hard cutout with no fill) isn't offered separately from image
replacement since the same segmentation mask underlies both — API note left for whoever "removes" it in
the brief's checklist: a transparent/solid-color background is one `applyImage` call away, not a separate
code path.

## Calls (Stage 15)

Real 1:1 calling — ring, accept, reject, busy, cancel, missed (in-process 45s timeout), call history — on
the `Call`/`CallParticipant` schema that had sat unused since Stage 2. New `apps/api/src/calls`
(`CallsService`/`CallsController`) replaces `ContactsService.call`'s old stand-in (which just created an
instant `Meeting` and pushed a notification, no real ringing). Reuses the exact same media stack meetings
use — a call is architecturally just a lighter room: a `livekitRoomName` with no `Meeting` row, no waiting
room, no recording, no settings — the frontend's `CallOverlay` wraps the same `<LiveKitRoom>` +
`VideoGrid` components the meeting room does, per the brief's explicit instruction not to build a second
media engine. Global call state lives in a new Zustand `call-store.ts` (mirroring how `useNotifications`
already works), fed by a `useCallSocket` hook mounted once in `AppShell` so an incoming call can interrupt
any page, not just one screen.

**Verified live, end to end, with two real registered users** — not just the happy path:
outgoing-ring → incoming modal → accept → real two-way video (confirmed via screenshot, both fake camera
feeds correctly rendered in each other's grid) → hang up → call again (voice this time) → cancel before
answer → call again → decline → call history correctly showing all three (icons, direction arrows,
Declined/Canceled/duration). Zero console errors on either side across the whole sequence
(`.run-driver/drive-calls.js`, screenshots in `.run-driver/screenshots/calls/`).

**This is also where the most valuable bug-hunting of this session happened** — both found by actually
driving two browsers through the full flow, neither visible from code review alone:

- **A client-side socket singleton bug that silently orphaned listeners on reconnect.**
  `lib/socket.ts`'s `getSocket()` used to discard and recreate the shared Socket.IO connection any time it
  was called while the existing one hadn't finished connecting yet (`if (socket && socket.connected) return
  socket; if (socket) socket.disconnect();` then a fresh `io()`). Diagnosed by process of elimination: a
  raw Redis `SUBSCRIBE` on the broadcast channel confirmed the server published the correct
  `call:incoming` message; a server-side log confirmed the target Socket.IO room had a real local socket
  and the emit fired; a Playwright WebSocket-frame capture confirmed the exact frame physically arrived at
  the browser — and *still* the client's own Zustand store never saw it. The only place left to look was
  the client's event-listener wiring itself, which is where this was found: `useCallSocket`'s `useEffect`
  had attached its listeners to a socket object that `getSocket()` had already abandoned by the time the
  real connection settled (visible as several rapid "WebSocket is closed before the connection is
  established" warnings — React StrictMode's double-effect-invoke in dev reliably triggers this race, but
  the same race is reachable from any real reconnect in production too). Fixed by making `getSocket()`
  always return the same object once created, letting Socket.IO's own built-in reconnection do what it
  already does — the function no longer needs to manage that itself. This was invisible in every previous
  stage's live verification because meeting-room features (reactions, chat) join a room several seconds
  into a stable session, well past the window where this race fires; a call can arrive the instant someone
  lands on any page, hitting it directly.
- **A 1:1 call's non-hanger-up side never got marked as having left.** `CallsService.end` only ever
  updated the caller's own `CallParticipant` row and checked whether *everyone* was already `LEFT` before
  closing out the `Call` — correct for a group call, wrong for 1:1: the person who didn't click "Leave"
  (their screen just received `CALL_ENDED` and went back to idle) stayed `JOINED` forever, and the `Call`
  row stayed `ONGOING` in the database indefinitely. This silently broke the busy check on the very next
  call between the same two people ("This person is on another call" for a call that had, from the user's
  perspective, cleanly ended minutes earlier) — which is exactly how it was caught: the busy check did its
  job correctly, on bad underlying data. Fixed by closing out *every* still-`JOINED` participant (not just
  the caller's own) whenever a call with two or fewer total participants ends.

**Not yet built**: group calling UI (backend already accepts multiple `calleeUserIds`), call-waiting (a
second incoming call while already on one is currently just missed, per `CallOverlay`'s own comment),
switch-camera (mobile-only concern, no mobile calling UI yet), Bluetooth audio routing (browser-level,
not something this app controls directly).

## Classroom Assignments (Stage 16)

Real assignments on the `Assignment`/`AssignmentSubmission` schema, which had no representation at all
before this stage (`docs/feature-gap-analysis.md` §17 was a flat ❌). A teacher posts an assignment
(title, description, due date, an optional attached file) to a class; students submit a text answer
and/or a file, with resubmission overwriting the same row rather than accumulating history — a
resubmission explicitly clears any prior `score`/`feedback`/`gradedAt`, since the teacher needs to look
at the new version, not the old grade. The teacher grades with a numeric score and optional feedback.
Notifications fire at every step (posted → all active students, submitted/resubmitted → all teachers,
graded → that student), reusing the existing `NotificationsService.create` → live
`WS_EVENTS.NOTIFICATION_CREATED` pipeline from Stage 11 rather than inventing a second one.

File attachments (both the assignment's own material and a submission's file) reuse the exact same
presigned-upload pattern meeting-chat files already used (`apps/api/src/files`), extracted into a shared
`file-upload.util.ts` (MIME allowlist + filename sanitizing) so the two paths can't quietly drift apart —
scoped to a class via a new `FileAsset.classId` column rather than a meeting. Download permission is
checked per-file: the assignment's own material is visible to any class member, but a submission's file
is visible only to the student who submitted it or a teacher of that class.

**Verified live with two real registered users, through the real UI**: teacher creates a class, enrolls
a student, opens the class page, and posts an assignment with a real file attachment
(`test-image.png`, confirmed "886 B" on both sides — same upload pipeline, now proven for the `CLASS`
scope too, not just `MEETING`). Student opens the class page, sees the assignment and its attachment,
submits a text answer plus a different real file, and the file shows up correctly. Teacher reloads,
opens "View submissions", sees the student's real answer and file, enters a score (92) and feedback, and
grades it. Student reloads and sees "Graded: 92 points — Great real-world examples!" with their answer
and file still attached, and their notification badge incremented from the grading notification — a full
round trip through real HTTP requests, a real Postgres write, and a real WebSocket push, not a UI mock.
Zero console errors on either side (`.run-driver/drive-assignments.js`,
`.run-driver/screenshots/assignments/`).

**A schema-drift lesson worth recording for future migrations**: `ASSIGNMENT` was added to the existing
`NotificationType` enum in a *second* schema edit, after `prisma migrate dev` had already run and
captured the `Assignment`/`AssignmentSubmission` tables. That's schema drift, not something Prisma
retroactively folds into the migration already generated — it silently produced a TypeScript type error
(`'"ASSIGNMENT"' is not assignable to type 'NotificationType'`) rather than a runtime one, caught at
typecheck. Fixed with its own follow-up migration (`ALTER TYPE "NotificationType" ADD VALUE
'ASSIGNMENT'`), then rebuilding `@arutech/database` so the regenerated Prisma Client types actually
propagate to dependent packages — any schema edit made after its migration has already run needs its own
migration, not a re-run of the previous one.

**The one real bug this stage's live verification caught** (invisible from code review, exactly the kind
of thing this project's discipline of live-driving two real browsers exists to catch): the student's
"Submit / view grade" panel got permanently stuck on "Loading…", even though the underlying
`GET .../submissions/me` request was succeeding. Root cause: when a NestJS controller method returns a
bare `null` (Prisma's correct, expected response for "no submission yet"), Nest's Express adapter treats
`null`/`undefined` as "send no body at all" — the response comes back `200 OK` with `Content-Length: 0`,
not a JSON body containing the literal `null`. The frontend's `apiFetch` reads that empty body back as
`undefined` (its documented behavior for genuinely void responses like a 200 with no body), which is
byte-for-byte the same value `StudentSubmission`'s component state started in before the request ever
ran — so "request succeeded, there's no submission yet" and "request hasn't resolved yet" were
indistinguishable to the component, and it never left its Loading state. Fixed on the frontend by
tracking "has this loaded" as its own boolean, independent of the fetched value, rather than inferring it
from whether the value is still `undefined` — the only fix that holds regardless of whether a given
"no data" API response happens to serialize as an empty body or a literal `null`.

**Not yet built**: submission history (deliberately — see the resubmission-overwrites design above),
rubrics/multi-criteria grading (single numeric score only), late-submission flagging against `dueAt`
(the due date is stored and shown but not yet enforced or highlighted), bulk grading/CSV export (Stage 9
Admin CSV export exists but doesn't cover assignments).

## Meeting info panel (Stage 17)

The last open item from Priority 1's original list (`docs/advanced-features-roadmap.md`) — the other three
(reply/DM/reactions/attachments chat rewrite, recording consent, local recording) had already been
completed in earlier stages; that doc's Priority 1 section was stale and is corrected alongside this
write-up. A dedicated "i" info panel was genuinely missing: the header only ever showed the title, code,
and an Encrypted/Recording pill, with no invite-link copy or security detail anywhere.

`meeting-info-panel.tsx` adds it as a proper panel in the existing tab system (`PanelKind`/`PANEL_TABS`,
the same mechanism Participants/Chat/Tools/Record already use), reachable by clicking the meeting
title/code in the header — matching Zoom/Meet's own "click the meeting name for details" convention —
so it's discoverable without adding another icon to an already-busy toolbar. Contents:

- **Invite link + meeting code**, each with its own copy button (`navigator.clipboard.writeText`, "Copied!"
  feedback for 2s) — the exact same link-construction convention the dashboard's personal-room card
  already used (`${origin}/meeting/${code}`), kept consistent rather than inventing a second format.
- **Security summary**: password-required and waiting-room on/off, sourced from the already-public
  `GET /meetings/:code` preview endpoint (the same scrubbed shape an unauthenticated guest sees before
  joining — never the password hash itself) rather than adding a second endpoint that would have to
  re-derive the same two booleans.
- **An honest E2EE caveat**, paraphrasing `docs/webrtc.md`'s own already-written "not implemented" section
  rather than letting the header's "Encrypted" pill (DTLS-SRTP, not end-to-end) stand unexplained — this
  is the one part of this stage that's documentation-in-the-UI rather than new functionality, deliberately,
  since inventing a difference here would misrepresent what's actually running.
- **Current recording status**, reusing `meeting-room.tsx`'s already-tracked `isRecording` state (no new
  fetch), plus a note that the AI meeting assistant is a post-recording batch step (Stage 8), not a live
  toggle — stated plainly rather than implying a live "AI assistant on/off" control that doesn't exist in
  this architecture.

**Verified live** (`.run-driver/drive-meeting-info.js`, screenshots in
`.run-driver/screenshots/meeting-info/`): a real registered user starts an instant meeting, opens the
panel, confirms the invite link and security rows render correctly, copies the link and reads the
clipboard back to confirm it actually matches (not just that a "Copied!" label appeared), confirms the
recording status line, switches to the Participants tab and back to Info to confirm the panel re-renders
cleanly rather than going stale, then closes it via the same title-click toggle. Zero console errors.

**A second gap found while writing this stage's docs, not by testing**: the roadmap's own item 3
("recording consent banner") had been drafted with the header's `isRecording` pill treated as if it
already satisfied it — it explicitly doesn't (a participant not looking at the header the instant
recording starts would never see it), and no separate banner existed anywhere. Caught by re-reading the
roadmap item's own wording before marking it done rather than trusting the existing pill at face value.
Fixed for real: an explicit, dismissible "This meeting is being recorded" banner
(`meeting-room.tsx`'s `recordingBanner` state), independent of the always-on pill, fired both on the live
`WS_EVENTS.RECORDING_STARTED` event and for a participant who joins a meeting where recording is already
in progress (the seed-fetch effect that already existed for the pill) — either moment is equally
consent-relevant. Auto-dismisses after 8s or on manual close; dismissing it never touches the persistent
pill, which is a separate, independent signal.

**A real environment gap surfaced while verifying this, worth recording in detail**: this session's
isolated verification stack's LiveKit instance (`arutech-verify-livekit2`, LiveKit's own `--dev` mode) has
no Egress worker registered with it — Egress workers register via the *same Redis* the LiveKit server
itself is configured to use, and `--dev` mode runs with no Redis at all, so `RecordingsService.start`'s
`EgressClient.startRoomCompositeEgress` call had nothing to dispatch to and either timed out or failed
outright depending on room state. This is a pre-existing gap in the verification stack, not an app bug —
confirmed by inspecting the actual API logs (a genuine `TimeoutError`, then a `twirp error unknown:
requested room does not exist` once retried without a joined participant) rather than assuming. Standing
up a redis-backed LiveKit + Egress pair to test this one banner was judged more disruptive than warranted
(this environment restricts stopping/removing some already-running containers, discovered when a
`docker rm -f` on the existing LiveKit container silently failed and the replacement `docker run` hit a
name conflict) — so verification instead published the exact same message
`RecordingsService.start`/`.stop` would publish onto the exact same Redis channel
`RealtimeBroadcastService.publish` uses (`${REDIS_PREFIX}:meeting:${meetingId}`, via
`docker exec arutech-verify-redis redis-cli PUBLISH`), which exercises every line of code this stage
actually added — the gateway's subscription, the fan-out to the meeting's Socket.IO room, the client's
real WS listener, the real banner render/dismiss/auto-timeout — live, over the real transport, with the
only thing not exercised being the already-proven, unrelated Egress RPC plumbing itself
(`.run-driver/drive-recording-consent.js`, screenshots in `.run-driver/screenshots/recording-consent/`).
Zero console errors on either participant's side. A scratch `egress.verify.yaml` and a short-lived
`arutech-verify-egress` container were created and torn down while diagnosing this before landing on the
injection approach; nothing from that dead end was left running. Also found and removed in passing: an
empty `infrastructure/docker/egress.local-run.yaml` *directory* (not a file) left over from this same
class of docker-bind-mount issue in an earlier stage — untracked debris, not real config.

## Local recording (Stage 18)

The last open item from Priority 1's original list — `local-recording-control.tsx`, a genuinely separate
code path from the server-side LiveKit Egress recording, running entirely in the browser and never
touching the API. It composites every `<video>` element currently inside the meeting's video grid
(`data-video-grid-root`, added in Stage 17 for the recording-consent banner's own DOM queries, reused
here) onto a canvas every frame via `requestAnimationFrame`, laid out in a simple square grid with each
tile letterboxed to preserve its aspect ratio, then `canvas.captureStream(30)` provides the video track.
Audio is a real Web Audio API mix: every `<audio>` element LiveKit's `RoomAudioRenderer` renders for
remote participants gets wrapped with `createMediaElementSource` and connected to a
`MediaStreamAudioDestinationNode` (re-connected to the audio context's own destination too, so wrapping
an element for recording never silences it for the person recording) — plus this participant's own
microphone, sourced from the already-published local track's `MediaStreamTrack` rather than opening the
device a second time, connected only to the recording destination (never played back to the recorder's
own speakers, which would be a live echo). A short interval re-scans for newly-joined participants'
`<audio>` elements every few seconds so someone joining mid-recording gets mixed in without a restart.
`MediaRecorder` encodes the combined stream (VP9/Opus in a WebM container, falling back down the codec
list via `MediaRecorder.isTypeSupported`), and stopping triggers an immediate, real browser download —
nothing is ever uploaded anywhere, and any participant can use it, not just the host (no Egress
dependency at all, which is the entire point of it existing as a fallback).

**Verified live with two real registered users** (`.run-driver/drive-local-recording.js`, screenshots in
`.run-driver/screenshots/local-recording/`): both join a real meeting, A starts a local recording, lets it
run for several seconds with both participants' fake-device video visible, stops it, and Playwright
captures the actual triggered download event rather than assuming the click worked — a real 474KB `.webm`
file. Verification went past just the byte count: `ffprobe` confirmed a genuine VP9 video stream
(1280×720, matching the canvas) and a genuine Opus audio stream (48kHz); extracting a frame with `ffmpeg`
visually confirmed both participants' distinct fake-device test patterns correctly letterboxed
side-by-side, each still showing its own live, moving synthetic timecode (proof of live frame capture, not
a static image); and `ffmpeg`'s `volumedetect` filter confirmed the audio track is real and non-silent
(mean −17.2dB, ~449k samples over the ~9.3s clip) rather than an empty/silent track. A final check
confirmed local recording never creates a server-side `MeetingRecording` row — genuinely a separate path,
not secretly routing through the same API endpoint. Zero console errors on either side.

**Not yet built**: a lower-thirds/name-label overlay on each composited tile (the download is a clean
video-only composite today, no on-screen names — Zoom's local recording overlays them, a real gap for
parity, tracked here rather than silently treated as done), pause/resume (MediaRecorder itself supports
`.pause()`/`.resume()`, just not wired to a UI control yet), a resolution/quality picker (fixed at
1280×720/30fps).

## Courses / Batches (Stage 19)

First item of Priority 2's remaining list — `docs/advanced-features-roadmap.md` itself framed this as a
genuine open question rather than a foregone rebuild: promote the flat `Class` model into a full
`Course` → `Batch` → `Class` (session) hierarchy, *or* recognize that a `Class` already **is** what the
brief calls a "batch" (one fixed roster, one teacher set, its own sessions and — since Stage 16 —
assignments) and the only thing genuinely missing is the shared-curriculum layer *above* it. Went with the
latter: a new `Course` model, and `Class.courseId` — nullable, purely additive. A `Class` created with no
`courseId` behaves exactly as it always has (this is deliberate: the existing `/classes` page's own
"Create class" flow was left untouched, so it keeps producing course-less classes exactly as before);
attaching one to a `Course` is opt-in, done from the new course detail page's "+ New batch" action.

`Course` has no `CourseTeacher` join table — it has exactly one creator/owner, mirroring
`Class.ownerTeacherId`. Every actual permission (who teaches which batch, who's enrolled in which batch)
stays entirely on the `Class` itself via the existing `ClassesService`; a course grouping never changes
who can do what inside any individual batch — it's purely an organizing label. The one place `Course`
and `Class` actually interact permission-wise: `CoursesService.assertOwnedCourse` blocks attaching a new
or existing class to a course you don't own, called from both `ClassesService.create` and `.update`
whenever a `courseId` is supplied — otherwise anyone could attach their own class as a "batch" of someone
else's course by guessing its id. `GET /courses` lists courses the caller created *or* has any
relationship to via a batch (teaching or enrolled in one) — a student sees the course their class belongs
to without ever having created anything, and without being able to add batches to it themselves.

New `apps/api/src/courses` (`CoursesService`/`CoursesController`), a new "Courses" top-level nav item
(`/courses` list + `/courses/:id` detail showing its batches with teacher/student counts), and the
existing class detail page now shows a "Part of {course title}" backlink when a class has one. 10 new
unit tests (`courses.service.spec.ts`) cover ownership checks on create/update/delete, the
`assertOwnedCourse` guard, and the derived-membership access check — full API suite now 87 tests across
14 suites.

**Verified live** with three real registered users through the real UI (`.run-driver/drive-courses.js`,
screenshots in `.run-driver/screenshots/courses/`): a teacher creates a course, creates two batches under
it from the course detail page, confirms the class page links back up to its course; enrolls a student
into one batch and confirms the student sees the course listed (derived from batch membership, never
having created it) but has no "+ New batch" control on it; and confirms, via direct API calls from a
third, entirely unrelated teacher's session, both that reading a course you have no relationship to
returns a real 403 (not just a hidden UI element) and that attaching a brand-new class to someone else's
course by guessing its id also returns a real 403. Zero console errors on either the teacher's or the
student's side.

**Not yet built**: bulk operations across a course's batches (e.g. posting one assignment to every batch
at once — today each batch's assignments are still fully independent, by design, since Stage 16 scoped
`Assignment` to a single `Class`), a "clone this batch's assignments into a new batch" convenience, and no
course-level roster/analytics view aggregating across batches.

## Quiz question types (Stage 20)

Second item of Priority 2's remaining list — true/false and short-answer alongside the existing
multiple-choice, on the quiz feature that's been real since Stage 6. New `QuizQuestionType` enum
(`MULTIPLE_CHOICE`/`TRUE_FALSE`/`SHORT_ANSWER`) on `QuizQuestion`, plus a nullable
`correctAnswerText`/`answerText` pair on `QuizQuestion`/`QuizAnswer` for the short-answer path. Deliberately
minimal new surface area: `TRUE_FALSE` is modeled as `MULTIPLE_CHOICE` under the hood — the server
generates exactly two `QuizOption` rows ("True"/"False") from a boolean `correctAnswer` in the create
request, so it rides the *exact* same option/answer/grading/broadcast pipeline `MULTIPLE_CHOICE` already
had; `type` only changes how the client renders it (a two-button toggle instead of an option list). Only
`SHORT_ANSWER` is genuinely new grading logic: no `QuizOption` rows at all, graded by a case-insensitive,
trimmed exact-string match against `correctAnswerText` — documented plainly as exact-match-only, no
fuzzy/synonym matching, rather than implying something smarter than what's actually there.

The validation schema (`quizQuestionSchema`) is a Zod discriminated union on `type` — each of the three
branches requires exactly the fields that make sense for it (`options` for MCQ, `correctAnswer: boolean`
for true/false, `correctAnswerText` for short-answer), so a malformed combination is a 400 at the edge,
never a runtime surprise inside `QuizzesService`. `answerQuizQuestionSchema` similarly accepts exactly one
of `selectedOptionId`/`answerText` — `QuizzesService.answer` branches on the question's own `type` (not
which field the client happened to send) and explicitly rejects the wrong shape for that type, so an
answer can't accidentally get graded through the wrong path. The existing answer-key-withholding
discipline — `isCorrect` never sent before an answer/close, the same principle `docs/api.md` already
documents for MCQ — was extended to cover `correctAnswerText` too: it's absent from every payload until
`close()` reveals it, verified directly by a unit test asserting the string "Paris" never appears anywhere
in the `QUIZ_PUBLISHED` broadcast payload for a short-answer question.

8 new unit tests (`quizzes.service.spec.ts` — this quiz feature had none before) cover the True/False
option-generation, short-answer storage, the answer-key-withholding guarantee, case-insensitive/trimmed
short-answer grading (both correct and incorrect), and that each answer type rejects the other type's
payload shape. Full API suite now 95 tests across 15 suites.

**Verified live** with two real registered users in a real meeting (`.run-driver/drive-quiz-types.js`,
screenshots in `.run-driver/screenshots/quiz-types/`): teacher publishes a True/False question, student
sees both toggle buttons and answers correctly; teacher closes it and the leaderboard shows the student.
Teacher publishes a short-answer question ("Capital of France?"), student deliberately submits `"  pARIS
  "` (mixed case, extra whitespace) and is graded correct, proving the normalization actually runs rather
than being an unused code path; closing reveals "Correct answer: Paris" to the teacher. Then a
multiple-choice question as a regression check on the pre-existing type, confirmed still working
end-to-end after the discriminated-union rewrite touched its validation schema too. Zero console errors on
either side throughout.

**Not yet built**: multiple acceptable answers for short-answer (today exactly one canonical string),
partial-credit/fuzzy matching, per-question-type analytics on the leaderboard (it's still just a total
score across all question types mixed together).

## AI classroom assistant (Stage 21)

Last item of Priority 2 — lecture notes, a study guide, flashcards, and practice questions generated from
a class session's transcript, for a teacher to review and publish to students. Reuses the Stage 8 AI
meeting assistant's `SummarizationProvider` interface rather than a second AI pipeline: a new
`generateStudyMaterial` method alongside the existing `summarize`, same OpenAI client, same
selection-by-`AI_PROVIDER`-env-var, just a different system prompt and a different Structured Outputs JSON
schema. New `ClassroomStudyMaterial` model (`status: DRAFT | PUBLISHED`, per the brief's own
review-before-publish requirement) referencing a `MeetingTranscript` — a class session is just a `Meeting`
with `type: CLASS`, so it already gets the exact same recording → transcript pipeline every other meeting
does, with nothing class-specific to build there. `StudyMaterialsService.generate` validates the given
transcript is both `READY` and actually belongs to one of this class's own sessions before ever calling
the LLM — otherwise a teacher could generate "classroom" content scoped to their class from a completely
unrelated meeting's transcript by guessing its id. Deliberately synchronous (unlike
`TranscriptsService`'s fire-and-forget `PENDING`/`PROCESSING` pattern) since this is one bounded
chat-completion call, not a multi-step audio pipeline — documented as the simpler choice for now, worth
revisiting only if real-world latency makes it a bad trade. The review-before-publish gate is enforced
server-side, not just hidden in the UI: `list`/`getOne` filter `DRAFT` rows out entirely for a
non-teacher, and a student requesting a draft by id gets a 404 (not a 403) — the same "they have no
legitimate reason to know it exists" treatment `AssignmentsService` already uses. 13 new unit tests
(`study-materials.service.spec.ts`); full API suite now 108 tests across 16 suites.

**Verification had to work around a real, pre-existing environment gap — worked around honestly, not
routed around silently.** No `OPENAI_API_KEY` is configured in this session's dev environment (confirmed
by reading the running API process's actual environment, not assumed), so both `TranscriptionProvider`
and `SummarizationProvider` resolve to their `Null*` implementations here — meaning neither a transcript
nor a study material can actually be generated via a real LLM call in this environment at all, for this
feature or for the pre-existing Stage 8 one. This is not a gap this stage introduced; Stage 8's own tests
were already "provider boundary mocked" for exactly this reason. Verification here went as far as real
infrastructure allows and was explicit about the one boundary it couldn't cross:

- **Confirmed for real, via curl against the live API**: `GET .../eligible-transcripts` correctly lists a
  real `READY` transcript seeded directly into Postgres (via a `tsx` script using the same generated
  Prisma client the API uses — real rows, real foreign keys, not a mock) for a real class/session/meeting
  created through the real API by two freshly-registered real users. Then `POST .../study-materials`
  against that real transcript was called for real and returned a genuine `503 SERVICE_UNAVAILABLE` with
  the exact configured message — proving the whole request path up to the provider boundary (permission
  checks, transcript-eligibility validation, provider injection) is real and fails *honestly* rather than
  crashing or silently returning fake content.
- **Everything past that boundary — the actually-new, actually-risky code this stage adds (the
  DRAFT/PUBLISHED state machine and its visibility rules) — was verified live, through the real UI, with
  two real browsers**, by seeding one `ClassroomStudyMaterial` row directly (bypassing only the LLM call
  itself, the same technique Stage 17's recording-consent-banner verification used for its own
  unrelated infrastructure gap): a student's class page showed "No study materials yet." with zero trace
  of the draft; the teacher's page showed it labeled "Draft — not visible to students," and its lecture
  notes/study guide/flashcards/practice-question tabs all rendered the real seeded content correctly,
  including the correct practice-question option visibly marked (✓) for the teacher only; clicking
  "Publish to students" flipped it to "Published" and made the Publish button disappear; the student then
  reloaded and saw the exact same real content for the first time, with a real notification badge
  confirming `NotificationsService.create` actually fired, and correctly had no Publish control of their
  own. Zero console errors on either side throughout
  (`.run-driver/drive-study-materials.js`, screenshots in `.run-driver/screenshots/study-materials/`).

**Not yet built**: regenerating/editing already-generated content (a teacher who wants different phrasing
has to delete and generate again), turning a practice question into a real `Quiz` question with one click
(today they're separate, read-only content — no auto-publish into the live quiz system, which would
bypass the same review step this stage exists to enforce), multi-transcript synthesis (one study material
per transcript, not "combine these three sessions").

## Contacts: block, favorite, groups (Stage 22)

Second item of Priority 3 — Calls itself (item 1) was already done in Stage 15. Three genuinely new,
small models (`BlockedUser`, `ContactFavorite`, `ContactGroup`/`ContactGroupMember`) layered on top of
`ContactsService`'s existing derived-from-meeting-history contact list, which itself needed no schema
change — block/favorite/group are exactly the per-user state that *can't* be derived from meeting history,
so they're the one place this feature genuinely needed real tables.

Block is checked **symmetrically** — a block row in either direction blocks both directions — a
deliberate simplification over tracking "who blocked whom" at every call site: if either person severed
the relationship, neither side should be able to reach the other, regardless of who initiated it. Enforced
at both places an unwanted interaction could otherwise start: `CallsService.initiate` (checked per callee,
already written to support the group-calling array even though only 1:1 ships today) and
`ChatService.createRoom` for a `DIRECT` room. Meeting invite was the third site the original roadmap item
named — this codebase has no targeted "invite a specific user" endpoint at all (meetings are joined via
code/link, never a per-user invite), so there was nothing concrete to add a check to; noted honestly here
rather than inventing an invite feature just to have something to block. Blocking removes the other
person from `list()` entirely (not just disables their row's buttons), matching how most chat/calling
products hide a blocked person from the main contact list — `GET /contacts/blocked` is the separate
"manage who I've blocked" view.

Contact **groups** are a personal organizing label a user can put their own contacts into
(`ContactGroup.ownerUserId`, no shared-membership concept) — worth being explicit that this is a
*different* thing from Team Chat's `GROUP`-typed `ChatRoom` despite sharing the word "group": one is "who
I've filed under a label I made up," the other is a shared multi-person chat room. Conflating them would
have been the wrong design; kept as two unrelated concepts on purpose. 8 new `ContactsService` unit tests
plus 2 more on `ChatService.createRoom`'s new block check (`CallsService`'s existing spec gained one);
full API suite now 119 tests across 17 suites.

**Verified live** with two real registered users who actually shared a real meeting (`.run-driver/drive-contacts.js`,
screenshots in `.run-driver/screenshots/contacts/`): A favorites B (star fills, sorts first), creates a
group and adds B to it (group chip appears on both the group panel and B's contact row), blocks B — B
disappears from A's contact list immediately and appears in A's "Blocked" view — then, calling the API
directly as B (who never blocked anyone), confirmed B's own attempt to open a DM with A gets a real 403,
proving the symmetric check actually works from the other side, not just the blocker's. A unblocks B and
B reappears. Zero real console errors (one *expected* console line from Chrome logging B's own deliberate
403 fetch probe, not an app-triggered error).

**A real, pre-existing environment gap hit again, same root cause as Stage 17/18's**: this session's
isolated LiveKit instance has no webhook delivery to the API, so `MeetingParticipant.status` never
actually transitions to `JOINED` here — meaning the derived contacts list (which queries exactly that
status) came back empty even though both users had genuinely joined the meeting via real WebRTC (confirmed
by both reaching the real in-meeting UI). This is the identical gap `.run-driver/drive-calls.js` already
documented in its own comment for the Calls stage; not new, not routed around silently — worked around by
patching just the one webhook-dependent status field directly in Postgres via the same generated Prisma
client the API uses, then verifying everything else (the actual new code this stage adds) live through
the real UI exactly as usual.

**Not yet built**: a UI to rename a contact group (only create/delete), blocking someone from inside an
active meeting (today's block only affects calls/DMs going forward, not an in-progress meeting
participant — that's Priority 5's "moderation" item's own explicit scope), bulk-add a group to a call/DM.

## Team Chat groups (Stage 23)

Third item of Priority 3 — the roadmap item itself floated a design choice rather than assuming one: a new
`Group` model, or `ChatRoom` gaining a `photoUrl` and `ChatMember` gaining an admin role. Went with the
latter, exactly as the lighter-weight option the item recommended: `ChatRoom.photoUrl` (a plain URL, same
convention `User.avatarUrl`/`Organization.logoUrl` already use — none of the three has a presigned-upload
pipeline yet, a shared follow-up rather than something scoped to group photos specifically) and
`ChatMember.isAdmin`, meaningful only for `GROUP` rooms. The room's creator becomes its sole admin;
everyone else has to be promoted. `demoteAdmin` refuses to leave a group with zero admins (no one left who
could promote a replacement). Five new admin-gated `ChatService` methods (`updateRoom`/`addMember`/
`removeMember`/`promoteAdmin`/`demoteAdmin`), each broadcasting a new `WS_EVENTS.ROOM_UPDATED` (a
refetch signal, matching `TRANSCRIPT_UPDATED`'s shape, not the full new state) to the room's channel — the
same "only reaches clients with that room's tab currently open" limitation `ROOM_MESSAGE`'s live sidebar
preview already has, not a new gap this stage introduced.

Worth being explicit about a naming collision: this is a *different* thing from Stage 22's `ContactGroup`
despite both being called "groups." `ContactGroup` is a personal label a user files their own contacts
under (no shared membership). A Team Chat `GROUP` room is an actual shared multi-person conversation.
Conflating them would have been the wrong design — kept as two unrelated models on purpose.

The "group meeting/call shortcut" the roadmap item asked for is a "Start a meeting" button that creates a
real instant `Meeting` (already fully N-person capable — that's the whole media engine) and posts the join
link into the group chat, rather than building a genuinely new multi-party ring/accept UI on top of Calls.
That's a deliberate scoping call, not a shortcut past the harder problem: `CallsService.initiate` already
accepts multiple `calleeUserIds` and rings/joins all of them correctly end-to-end (verified by reading
`accept`/`end`'s own handling of >2 participants), but the *client* (`call-store.ts`'s `startCall`) is
still hardcoded to a single peer — building a real group-calling UI is Stage 15's own explicitly-named
"not yet built" item, a separate and larger piece of work than this stage's scope. Using Meetings for a
group's "call everyone" need is architecturally the more correct answer anyway: Calls is the lightweight
1:1-oriented primitive, Meetings is the N-person one.

12 new `ChatService` unit tests (creator-becomes-admin, admin-gating on all five management methods, the
last-admin-can't-be-demoted guard); full API suite now 129 tests across 17 suites.

**Verified live** with three real registered users who'd shared a real meeting (`.run-driver/drive-groups.js`,
screenshots in `.run-driver/screenshots/groups/`): A creates a group with B and C through the real New Chat
UI, renames it and sets a photo, promotes B to admin (badge appears live). B — now genuinely an admin,
confirmed by seeing their own management controls — removes C. C's own session, reloaded, no longer sees
the group at all. The trickiest check: A's own open Manage panel, having done nothing itself, correctly
dropped to "Members (2)" after B's removal — proving the `ROOM_UPDATED` broadcast → client refetch pipeline
actually works live, not just that the mutation succeeded on the backend. Then A used "Start a meeting"
from the group, landed on a real meeting page, and B's own session (never touched by A directly) saw the
real join-link message appear in the chat. Zero console errors across all three sessions.

**A real environment-recovery detour, not a code issue, worth recording in detail**: mid-stage, the
underlying sandbox restarted — every docker container in this session's isolated verification stack
(Postgres, Redis, LiveKit, MinIO, Egress) came back `Exited`, and this session's own dev-server processes
and `/tmp` scratchpad were gone (ephemeral storage doesn't survive a VM restart the way the containers'
own data volumes and the repo's real files on disk do). Confirmed via `docker ps -a` before touching
anything, rather than assuming. Recovery, in order: `docker start` on the four still-needed containers
(skipped Egress — already a known, accepted gap, see Stage 17); confirmed via `psql` that every migration
this entire session had run, and the `demo@arutech.dev` account, both survived intact on the restarted
Postgres container: only the *processes* were gone, never the *data*. Relaunching the API dev server
surfaced a second, separate discovery: this codebase's `ConfigModule` reads `process.env` directly with no
dotenv loading anywhere (confirmed by reading `config.module.ts`), so a `.env` file alone does nothing —
every env var (including the verify-stack's non-default `DATABASE_URL`/`REDIS_URL`/`LIVEKIT_*`/`S3_*`)
had to be passed as literal inline `VAR=value` prefixes on the actual launch command, which is almost
certainly how it was originally set up long before this stage. A stray `pkill -f "nest start --watch"`
during recovery also silently matched nothing (the real process name is `nest.js start --watch`, not `nest
start --watch`) and left zombie watchers racing on the same log file across several relaunch attempts
before this was caught by inspecting `ps` output directly instead of trusting the kill command's exit
code. Both dev servers, the demo account, and the full test suite were all confirmed healthy before
resuming — see the tail of this stage's own verification for that evidence.

**Not yet built**: a way to rename/re-photo a `DIRECT` room (meaningless — matches existing convention),
transferring "sole ownership" beyond admin (there's no distinction between the original creator and a
later-promoted admin once promoted — intentionally flat), a live indicator for who's currently viewing a
group (that's Priority 5's presence system).

## Personal chat parity gaps (Stage 24)

Fourth item of Priority 3: edit message, forward message, voice messages, typing indicator, and online
status — brought to meeting chat *and* Team Chat together, since Team Chat's `ChatService` methods are the
same ones meeting chat calls (`shapeMessage`, `MESSAGE_INCLUDE`, `persistRoomMessage` now built on the
same shaping path as meeting chat's `persistMessage`), not a parallel implementation to keep in sync.

**Edit**: `ChatMessage.editedAt`, own-message-only, both meeting (`PATCH /meetings/:id/chat/messages/:id`)
and Team Chat (`PATCH /chat-rooms/:id/messages/:messageId`) — broadcasts `WS_EVENTS.CHAT_MESSAGE_EDITED` /
`ROOM_MESSAGE_EDITED`.

**Forward**: `ChatMessage.forwardedFromSenderName` — a denormalized *name snapshot* of the original
sender, not a live foreign key back to the source message. That's a deliberate choice, not an oversight: a
live pointer would leak the source message (or require re-checking the forwarding recipient's access to
wherever it came from, every time they view it) into a room they may have no membership in at all. The
source can be either a meeting-chat or a Team Chat message — `forwardMessage` resolves which permission
check applies from the source's own `ChatRoom.type` rather than requiring the caller to say which kind it
is (same pattern Stage 23 used for `ContactGroup` vs. Team Chat `GROUP` disambiguation). v1 is deliberately
**text-only**: forwarding an attachment/voice-only message is refused outright rather than re-scoping a
`ChatAttachment`'s permission boundary to a second room in this pass.

**Voice messages**: not a new model — a `ChatAttachment` recorded client-side via `MediaRecorder`
(`use-voice-recorder.ts`) and uploaded through the exact same presigned-upload pipeline Stage 13 built for
file/image attachments, distinguished purely by `mimeType.startsWith("audio/")` at render time. Rendering
is shared between meeting chat and Team Chat via one new `ChatAttachmentView` component, parameterized by
`downloadPath` (which download endpoint to call) rather than duplicating the image/audio/file-button
rendering logic per surface.

**Typing indicator**: `WS_EVENTS.CHAT_TYPING` existed in the schema, unwired, before this stage — one
gateway handler now branches on a `meetingId` vs `chatRoomId` payload field to target the right room,
backing both meeting chat and Team Chat from the same code path. 2.5s debounce before broadcasting
"stopped typing."

**Online status ("last seen" v1)**: `User.lastSeenAt`, bumped on every WebSocket connect. The client (not
the server) decides "Online" (a 2-minute recency window) vs. "Last seen X ago" from the raw timestamp —
see `docs/feature-gap-analysis.md` §37 for why this is explicitly a simpler v1, not Priority 5's fuller
presence system (no live per-socket tracking, no away/busy/DND).

**Two real app bugs found and fixed live-verifying this** (both confirmed as genuine bugs, not
environment/test artifacts, by reproducing them against the real running app before touching any code):

1. **Voice messages were rejected outright.** `FilesService`/`ChatService`'s upload-presign path checked
   `ALLOWED_MIME_TYPES.has(dto.mimeType)` — an exact string match. Chrome's `MediaRecorder` reports
   `audio/webm;codecs=opus` as its blob's `mimeType`, not bare `audio/webm`, so every real voice recording
   hit `400 File type audio/webm;codecs=opus is not allowed` before ever reaching storage. First diagnosed
   as a broken Playwright fake-audio-capture flag (a red herring — removing
   `--use-file-for-fake-audio-capture=/dev/null` from the driver's Chrome launch args was a real fix for a
   real, separate issue with that flag, but didn't resolve this), then found by reading the actual error
   text rendered in the composer once the driver waited for and screenshotted the real UI state instead of
   only checking the DOM for an `<audio>` element's existence. Fixed with a new `isAllowedMimeType()` in
   `file-upload.util.ts` that strips any `;parameter=...` suffix before checking the allowlist — used by
   all three of this codebase's upload paths (`FilesService`, `ChatService`, `AssignmentsService`), not
   just the new voice-message one. The full MIME type (codecs suffix included) is still stored and sent as
   the actual upload's `Content-Type`, since that's genuinely useful playback information — only the
   allowlist check normalizes it away.
2. **The meeting-chat "Forward" picker mislabeled its own only real target.** `ForwardPicker.roomLabel`
   picked `room.members[0]?.user.displayName` for any `DIRECT` room — frequently the *caller themselves*,
   not the other person, since member order isn't guaranteed to exclude the viewer. Cosmetic on its own,
   but it masked a real test gap: a forward attempt landed nowhere (confirmed via a direct query — zero
   rows in `chat_messages` with `forwarded_from_sender_name` set — after a picker click that outwardly
   looked successful), which traced back to the live-verification driver's necessarily-generic click
   selector picking the wrong button once the intended one wasn't labeled the way the driver expected.
   Fixed to find the member whose `userId !== currentUserId`, matching the pattern the real Team Chat page
   (`apps/web/src/app/chat/page.tsx`) already used correctly elsewhere in the same codebase.

35 new `ChatService` unit tests this stage (edit ×2 contexts, delete-room, forward, presign, persist-with-
attachment); full API suite now 144 tests across 17 suites, typecheck/lint clean on both `apps/api` and
`apps/web`.

**Verified live** with two real registered users sharing a real meeting (`.run-driver/drive-chat-parity.js`,
screenshots in `.run-driver/screenshots/chat-parity/`): A types in meeting chat, B sees the live typing
indicator; A sends and then edits a message, B sees the edit and the "(edited)" tag appear live; A records
and sends a real voice message (genuine `MediaRecorder` capture against Chrome's synthetic fake-audio
device, not a stub), B receives a playable `<audio>` element whose `src` is a real signed MinIO URL; A
forwards that edited message into a real Team Chat DM with B, B sees it there with a "Forwarded from
Parity A" marker; in Team Chat directly, A gets a live typing indicator, sends and B receives another real
voice message, then A deletes their own message and B sees "Message deleted" live; finally A's Contacts
page shows B genuinely marked "Online". Zero console errors on both sessions across the entire run.

**A real, pre-existing environment gap re-encountered, not a new one**: re-joining the same meeting
partway through this stage's scenario (to reach the Forward action from inside the meeting UI a second
time) resets that `MeetingParticipant` row's `status` away from `JOINED` back to `WAITING`/`ADMITTED` —
the real `JOINED` transition only happens via a LiveKit webhook, which this session's isolated
verification LiveKit instance never delivers (the same gap documented in Stages 17/22/23). Since Contacts
requires a `JOINED`/`LEFT` participant row, the online-status check would otherwise fail on this
environment gap rather than a real bug; the driver re-runs the same `mark-participants-joined.ts` patch
used at the start of the run immediately after this rejoin.

## Calendar (Stage 25)

Fifth and final item of Priority 3, closing it out: day/week/month views over real scheduled meetings and
class sessions, plus an honest architecture-and-stub for Google/Outlook sync — exactly as the roadmap item
itself scoped both halves.

**A real modeling wrinkle surfaced before any UI work**: meetings and class sessions turn out to be
scheduled two genuinely different ways. A plain `Meeting` carries its own `scheduledStart`/`scheduledEnd`.
A class session is *also* just a `Meeting` (type `CLASS`, same join flow, same everything) linked 1:1 via
`ClassSession` — but `ClassesService.createSession` never sets that meeting's own `scheduledStart` at all;
the only place the date lives is `ClassSession.sessionDate`. A calendar built by querying `Meeting.
scheduledStart` alone would silently show every scheduled meeting and *no* class sessions. `CalendarService.
listEvents` queries both sources in parallel and merges them into one sorted list, rather than trying to
force class sessions into the meeting table's own scheduling field.

**A second, more consequential discovery**: `docs/feature-gap-analysis.md` had claimed recurring meetings
were ✅ done, citing `Meeting.recurrenceFrequency`/`recurrenceUntil` and the parent/child relation. Reading
`MeetingsService.create` end to end shows that's only half true — it stores the rule on one `Meeting` row
and never does anything with `parentMeetingId` or generates per-occurrence rows, and no frontend UI can
even create a RECURRING meeting today (`schedule-meeting-modal.tsx` only ever sends `type: "SCHEDULED"`).
Corrected that claim to 🔶 rather than quietly building the calendar around the wrong assumption (see
`docs/feature-gap-analysis.md` §1). For the calendar itself, this meant: a RECURRING meeting is a *rule*,
not a set of stored dates, so making it show up on multiple calendar days has to happen at read time —
`CalendarService.expandRecurrence` projects `scheduledStart` + `recurrenceFrequency` + `recurrenceUntil`
forward into the individual occurrence dates that fall in whatever `[from, to]` window the view requests,
fast-forwarding arithmetically past occurrences before `from` (rather than iterating one step at a time
from `scheduledStart`, which could be years in the past for a long-lived weekly meeting) and capped at 200
occurrences per series as a hard safety net. Every occurrence still opens the exact same one persistent
meeting room — clicking any of them is opening the same link, not a new room per date, which is
consistent with how a RECURRING meeting already behaves today.

**Calendar UI**: `/calendar`, three real views (not three CSS states of one list) — a 6-week month grid,
a 7-column week view, and a single-day agenda list — sharing one `GET /calendar/events?from=&to=` fetch
per range change. Meeting and class events are visually distinct (color + a class-name badge). Clicking
any event navigates straight into the real meeting join flow (`/meeting/:code`) — not a detail modal that
then makes you click again. Prev/Today/Next navigation re-fetches the range rather than filtering a
client-side cache of everything, so a far-future or far-past month is only ever as expensive as that one
request.

**Google/Outlook sync**: exactly the "architecture-and-stub first" scope the roadmap item asked for — a
`CalendarProvider` interface (`connect(userId, provider)`), mirroring `SummarizationProvider`'s shape from
Stage 8 down to the pattern of a `Null*` implementation that fails loudly. `NullCalendarProvider.connect`
throws a real `ServiceUnavailableException`, surfaced to the "Connect Google/Outlook Calendar" buttons as
a genuine, visible 503 — not a disabled button, not a fake "Connected!" toast. No OAuth flow, token
storage, or push/pull sync exists yet; that's real, separate, larger work a future stage would add by
implementing the interface, the same way `OpenAiSummarizationProvider` sits next to
`NullSummarizationProvider` today.

8 new `CalendarService` unit tests (range validation, plain-meeting shaping, WEEKLY projection across a
month, `recurrenceUntil` cutoff, long-running-series fast-forward, class-session shaping via `sessionDate`,
merged sort order); full API suite now 152 tests across 18 suites, typecheck/lint clean on both `apps/api`
and `apps/web`.

**Verified live** with one real registered user (`.run-driver/drive-calendar.js`, screenshots in
`.run-driver/screenshots/calendar/`): created a real scheduled meeting, a real WEEKLY recurring meeting,
and a real class + session for today, all through the actual REST API (not a DB shortcut). Month view
showed all three on today's cell, and — genuine proof the recurrence projection works, visible in the
screenshot itself — the same recurring meeting correctly appearing again on the following Monday's cell.
Navigating to next month made today's one-off meeting correctly disappear (confirming range-based
refetching, not a stale client-side cache). Day view listed all three with correct time/kind/class-name/
"recurring" labeling. Week view showed all three in today's column. Clicking the scheduled meeting's pill
landed on the real PreJoin lobby for that exact meeting code. "Connect Google Calendar" surfaced the real
503 message inline. Zero unexpected console errors (the only entries logged were an expected
`getUserMedia` device-not-found, since this driver — unlike the two-person media drivers — never needed
camera/mic fixtures, and the deliberately-triggered 503 itself).

**Not yet built**: the pre-event reminder job ("class starts in 10 minutes") — still only post-event
notifications exist; an hourly time-grid for week/day views (this pass's week/day views list events
stacked by day rather than positioned against clock hours — a real, useful view, just not the denser
hour-grid some calendar apps use); and, as scoped from the start, any actual OAuth/push-pull sync behind
`CalendarProvider`.

**Priority 3 is now fully closed out** — including item 1 (Calls), whose write-up in
`docs/advanced-features-roadmap.md` had gone stale after Stage 15 shipped it and was corrected this stage
alongside the recurring-meetings correction above.

## Bug fix: missing "End meeting" button

User-reported: "meeting end button is missing." Confirmed real — a host had no way to end a meeting for
everyone from the UI at all. `apps/web/src/components/meeting/meeting-toolbar.tsx` only ever had one
button, "Leave", which just disconnects the local participant from LiveKit; the meeting itself kept
running for everyone else regardless of who left, including the owner. `POST /meetings/:id/end`
(`MeetingsService.end`) already existed server-side and was already correctly capability-gated
(`meeting.end` — OWNER/HOST/TEACHER only, not CO_HOST) — it was simply never called from anywhere in the
frontend.

**A second, related bug surfaced while fixing the first**: `apps/web/src/hooks/use-meeting-socket.ts`
already had a complete, working `WS_EVENTS.MEETING_ENDED` listener — state (`meetingEnded`), and
`meeting-room.tsx` already had a whole `EndedScreen` ("This meeting has ended.") ready to render off it.
None of it could ever fire: `MeetingsService.end` updated the DB and closed the LiveKit room, but never
broadcast the event the client was already listening for. Every other participant's only signal that the
meeting was over was LiveKit's own forced disconnect going dark — never the friendly screen the client
already had fully built. Fixed by adding one `this.broadcast.publish(meeting.id, WS_EVENTS.MEETING_ENDED,
{})` call, sent *before* `liveKit.endRoom()` so it lands while participants are still connected to receive
it.

**Fix**: a host-only "End meeting" control next to "Leave" (gated on the `meeting.end` capability via the
shared `can()` matrix, not the broader `isModerator` flag — CO_HOST is a moderator role but doesn't hold
`meeting.end`, matching the server-side check exactly rather than showing a button that would just 403).
No confirm-dialog pattern exists anywhere else in this app to reuse, and ending a meeting has a much
bigger blast radius than any other single-click toolbar action (it disconnects every participant, not
just the host), so it arms on the first click (relabels to "Click again to end for everyone", auto-disarms
after 4s) and only actually calls the endpoint on the second.

3 new `MeetingsService` unit tests (capability check, status update, and — the regression test for the
actual bug — that `MEETING_ENDED` broadcasts before `liveKit.endRoom` is called). Full API suite now 155
tests across 19 suites.

**Verified live** with two real registered users (`.run-driver/drive-end-meeting.js`, screenshots in
`.run-driver/screenshots/end-meeting/`): the host sees exactly one "End meeting" button, the participant
sees none. A first click arms it without ending anything (participant confirmed still in the meeting). The
second click ends it — the host is routed to the dashboard, and the participant, without touching
anything, sees the real live "This meeting has ended." screen. A direct `GET /meetings/:code` confirms
`status: "ENDED"` server-side, not just a client-side illusion. Zero console errors on both sessions.

**A real environment-recovery detour, not a code issue**: mid-fix, the sandbox VM restarted again (same
class of event as Stages 22/23's write-ups). Docker containers came back `Exited` as before, but this time
a second, unexpected wrinkle: a systemd-managed **production** build (`next start -p 3000` /
`node apps/api/dist/main.js`, both `systemd+`-owned, both started at the exact VM-boot timestamp) had
already claimed ports 3000 and 4000 by the time this session's own dev servers were relaunched — serving a
stale pre-Stage-24 build with no `sudo` available to stop it. Rather than fight over the port, the API was
relaunched normally on 4000 (its process won that race) and the web dev server was moved to **3100**
(`CORS_ORIGINS` updated to allow both origins). A second discovery while reconnecting the media stack:
`arutech-verify-livekit2` (port 27880), not `arutech-verify-livekit` (17880), is the LiveKit instance this
session's `.env`/`.env.local` actually point at (confirmed by reading the root `.env` this session created
earlier, which records `LIVEKIT_URL=ws://localhost:27880` and matching S3/Redis/Postgres credentials) —
the first recovery attempt guessed the wrong one and had to be corrected. **Port 3000 still serves a stale
build and needs a `sudo`-capable session to stop/replace that systemd unit** — everything in this stage
was verified against the correct, current code on port 3100/4000, not the stale instance.

## Live captions (Stage 26)

The one open item left in Priority 4, closing it out. Real streaming, in-meeting captions — architecturally
distinct from Stage 8's AI meeting assistant, which is a *batch* pipeline (recording file → ffmpeg →
Whisper, after the meeting ends). This runs *while* the meeting is happening, against live LiveKit audio.

**A real new process type**: `services/transcription`, a genuine LiveKit Agents worker (`@livekit/agents` +
`@livekit/agents-plugin-openai`) — the first inhabitant of the `services/*` workspace glob that's ever had
actual code in it. It registers with LiveKit under a fixed agent name (`CAPTIONS_AGENT_IDENTITY`,
`@arutech/types`) and only joins a room via **explicit dispatch**, never automatically — a host clicks the
toolbar's new "Captions" control, `CaptionsService.start` calls `LiveKitService.startCaptions`, which calls
`AgentDispatchClient.createDispatch`. Same "real infra cost, so opt-in rather than on for every meeting"
reasoning recording already has.

**One STT stream per speaking participant, not one per room** — a deliberate departure from the framework's
own higher-level `AgentSession`/`RoomIO` stack, which is built around one agent linked to a *single*
participant (a voice-assistant shape: `RoomInputOptions.participantIdentity` defaults to "link to the first
participant" if left unset). Wrong for a meeting where anyone can speak. The agent instead uses
`@livekit/agents`' lower-level `Room`/`STT` primitives directly: on every `TrackSubscribed` audio track it
opens its own `SpeechStream`, pumps that participant's real audio frames in, and publishes each
interim/final segment back via `LocalParticipant.publishTranscription` — attributed to the *speaker's own*
LiveKit identity, not the agent's. That's LiveKit's own native room-transcription protocol, not a custom
event on this app's Socket.IO gateway: the web client reads it with `@livekit/components-react`'s
`useTranscriptions()` (new `caption-bar.tsx`), the same "reuse the media engine's own primitives" instinct
Stage 4's virtual background followed with `@livekit/track-processors`. STT itself is
`@livekit/agents-plugin-openai`'s `STT`, backed by OpenAI's Realtime transcription WebSocket API — a
different, genuinely streaming product from Stage 8's `whisper-1` REST call.

**Honest failure, not fake captions**: no `OPENAI_API_KEY` is configured in this session's environment
(the same gap Stage 8's AI meeting assistant hit). Rather than silently produce nothing, the agent checks
for the key right after connecting and, if missing, logs a clear reason and shuts the job down immediately
— mirroring `NullTranscriptionProvider`'s "fail loudly, never fabricate" convention. This is genuinely
useful in practice, not just principled: it's exactly what let this stage be live-verified as far as it
honestly could be (below) without a real OpenAI account.

**A real environment limitation found and worked around, live, mid-stage** — not a design choice made in
advance: the obvious way to answer "is captioning currently on for this room?" is
`AgentDispatchClient.listDispatch(roomName)`, LiveKit's own list-by-room API. Calling it — first through a
one-off script directly against the SDK, then confirmed again through the running API with debug logging —
showed it does **not** reliably scope by room against this LiveKit server build: a brand-new meeting that
had never once started captions still came back with an "active" dispatch, and the response's own `room`
field simply echoed back whatever room name was queried rather than reflecting where the dispatch actually
lived. `createDispatch`/`deleteDispatch` (given an exact, already-known dispatch id) were confirmed working
correctly — only the *list* call lies. Rather than build `captionsActive`/`stopCaptions` on a read call
that was directly observed to return wrong answers, `LiveKitService` now tracks the one active dispatch id
per room itself, in Redis (`{prefix}:captions:dispatch:{roomName}`) — this app's existing, explicitly
ephemeral-state store (see `RedisModule`'s own doc comment: "presence, distributed locks, rate limiting,
waiting-room queues... never a durable store"), set on start, read/cleared on stop and status checks, with
a 24h TTL as a safety net against a stop that never arrives. Re-verified after the fix: a fresh meeting
correctly reports `active: false`, flips to `true` after a real start, and back to `false` after stop —
confirmed via direct API calls before ever re-running the Playwright driver.

**The bot never leaks into the UI.** The agent's fixed identity means `video-grid.tsx` can filter it out by
exact match — necessary because `useTracks({withPlaceholder: true})` would otherwise still hand it an empty
camera tile (it never publishes video, being subscribe-only). It was never wired into `ParticipantsPanel`
at all, since that panel is driven entirely by this app's own `MeetingParticipant` roster via the real
`join()` REST flow — the agent bypasses that path entirely, connecting straight to LiveKit with its own
dispatch-issued token, so it was structurally invisible there without any extra work.

**Permissions**: new `captions.manage` capability, placed at the exact same tier as `recording.start`/
`recording.stop` in the shared matrix (owner/host/co-host/teacher — a co-host can start/stop captions the
same way they can start/stop a recording; a plain participant/student cannot). The toolbar's CC control
does double duty depending on role: for someone with `captions.manage` it starts/stops captioning
server-side; for everyone else, once captions are active, the same button only toggles their own local
caption-bar visibility — never a second, confusingly-similar button.

3 new `CaptionsService` unit tests plus a `captions.manage` capability-tier test in the shared permissions
matrix suite; full API suite now 159 tests across 20 suites, typecheck/lint clean on `apps/api`, `apps/web`,
and the new `services/transcription` package.

**Verified live** with two real registered users (`.run-driver/drive-captions.js`, screenshots in
`.run-driver/screenshots/captions/`): only the host sees the manage-captions control before anything
starts; starting it is a real dispatch, confirmed by tailing the live agent worker's own log — it genuinely
received the job, connected over real WebRTC, and joined the *exact* right meeting's room; every
participant learns captions are on live via broadcast, not a poll; the bot participant never rendered a
video tile and its raw identity never leaked into the visible UI anywhere; stopping cleanly cleared the
control for both sessions with no leftover state. Zero console errors on either side. The one thing this
environment genuinely could not verify — real caption text — is documented as an honest gap, not silently
skipped: the agent log for this exact run shows it receiving the dispatch, joining the room, and correctly
refusing to caption anything because `OPENAI_API_KEY` isn't set here, exactly as designed.

**Not yet built**: an actual language-selection UI (every segment already carries a real `language` field
end-to-end, but only one language is ever surfaced today), a downloadable transcript of what was captioned
live (deliberately out of scope — Stage 8's post-meeting transcript already covers "a copy of what was
said," live captions here are purely "read it on screen while it's happening"), and — should a
horizontally-scaled deployment ever need it — running more than one `services/transcription` worker
instance behind the same `agentName` (LiveKit's own worker pool would load-balance jobs across them; nothing
in this stage's code assumes exactly one).

**Priority 4 is now fully closed out.**

## Feature flags (Stage 27)

First item of Priority 5. A minimal, real feature-flag system — no new SaaS dependency, exactly as the
roadmap item itself scoped it.

**Schema**: `FeatureFlag` (`key`, `enabled`, optional `organizationId`). A key resolves through at most two
rows — an org-scoped override if one exists for the caller's org, else the global row, else **enabled by
default**. That default isn't a convenience choice, it's a correctness requirement: every feature already
shipping in this app was unconditionally on before this system existed, and introducing flags must never
silently turn one off for a key nobody has ever touched. `FeatureFlagsService.isEnabled(key, orgId?)` /
`isEnabledForMeeting(key, meetingId)` (resolves the org from the meeting itself, since every real call site
needed exactly that) are the only two methods anything outside the admin controller calls.

**A real Postgres constraint subtlety, caught before it became a real bug**: the natural schema is
`@@unique([key, organizationId])`, but Postgres treats every `NULL` as distinct from every other `NULL` in
a unique constraint — so that alone would silently allow *multiple* global rows for the same key (the case
that matters most, since the global row is the default everyone gets). Fixed by hand-editing the generated
migration to add two **partial** unique indexes instead (`WHERE organization_id IS NULL` /
`WHERE organization_id IS NOT NULL`) — something Prisma's schema DSL can't express directly. Confirmed via
`\d feature_flags` that both partial indexes exist exactly as intended. Since no compound-unique field
exists in the Prisma schema anymore, `FeatureFlagsService`'s upsert is written by hand (`findFirst` then
`create`-or-`update`-by-id) rather than `prisma.featureFlag.upsert()`, which needs a unique `where` target
that no longer exists — an acceptable non-atomic window for a low-traffic, admin-only table.

**Three flags actually wired to a real, server-enforced gate** (not every feature in the app — deliberately
scoped to a representative set spanning meeting and classroom features, per the roadmap item's own
"maps cleanly" framing rather than an exhaustive sweep of every controller):

- `WHITEBOARD` — checked in `WhiteboardService.getOrCreate`, the one real choke point every whiteboard
  interaction (open the panel, save a page, add a page) already goes through, **and** separately in the
  WS `whiteboard:op` handler in `RealtimeGateway` — live stroke sync bypasses `WhiteboardService` entirely
  (it's ephemeral, never persisted per-op), so gating only the REST side would have left live drawing
  reachable even with the flag off. Found by reading the gateway's own doc comment on that handler, not
  by trial and error.
- `BREAKOUT_ROOMS` — checked in `BreakoutRoomsService.create`, which already fetched the `meeting` row
  for its `orgId` anyway.
- `LIVE_CAPTIONS` — checked in `CaptionsService.start`, tying directly into last stage's feature.

**Admin UI**: `/admin/feature-flags`, new nav item. Lists every known key (the three wired ones, always
shown even with zero rows yet, plus any custom key an admin has created) with a one-click global
enable/disable toggle and per-organization overrides (add/toggle/remove, org picker sourced from the
existing `GET /admin/organizations`). A free-text field lets an admin create any other key too — it just
has no effect until some service actually calls `isEnabled` with it, stated plainly in the page's own copy
rather than implying every key does something.

**Client-side hiding, not the security boundary**: `GET /meetings/:id/feature-flags` resolves all three
known keys for one meeting in a single call (one `orgId` lookup shared across all three checks) — the
meeting UI uses this to hide the Whiteboard tab, the Breakout Rooms tab, and the Captions toolbar control
when disabled, so a participant never sees a button that would just 403. The real gate stays entirely
server-side regardless; hiding the button is purely so a disabled feature doesn't look broken.

13 new unit tests: 7 on `FeatureFlagsService` itself (default-enabled precedence, org-override-beats-global,
create-vs-update upsert paths, `isEnabledForMeeting`'s org resolution), 3 new flag-gating tests on
`WhiteboardService`'s first-ever spec file, 2 on `BreakoutRoomsService`'s first-ever spec file, and 1 more
on `CaptionsService` (which already had 3 from Stage 26). Full API suite now 172 tests across 23 suites,
typecheck/lint clean on `apps/api` and `apps/web`.

**Verified live** (`.run-driver/drive-feature-flags.js`, screenshots in `.run-driver/screenshots/
feature-flags/`) with a promoted admin and two real meeting participants: before disabling, the Whiteboard
tab is visible and a direct API call to it succeeds (200). The admin's real toggle click flips it to
"Disabled globally". A direct API call immediately afterward — not just checking the UI — now returns a
genuine 403, proving server-side enforcement rather than a client-side illusion. A participant who joins
*after* the flag was disabled never sees the Whiteboard tab at all, while unrelated tabs (Breakout) stay
untouched. Re-enabling flips the API call back to 200. A key that was never configured at all (BREAKOUT_
ROOMS, untouched this whole run) correctly defaults to enabled, confirmed by successfully creating real
breakout rooms through it. Zero unexpected console errors (the one logged entry is the browser's own
network log of the deliberately-triggered 403 fetch, not a bug).

**A real environment gap hit and worked around**: this session's environment has no seeded system-admin
account (`admin@arutech.dev` from `seed.ts` was never run against this particular database). Registered a
fresh user through the real UI and promoted it to `ADMIN` via a direct `UPDATE users SET system_role =
'ADMIN'` — the same class of documented, honest DB-patch workaround used earlier for the LiveKit webhook
gap, not a shortcut around anything this stage itself needed to prove. Also had to log the freshly-promoted
user out and back in before their session reflected the new role: `AdminLayout`'s client-side redirect
reads the Zustand-persisted `user` object from login time, which doesn't update just because the database
row changed underneath it — a real, if minor, staleness behavior worth knowing about (a promoted admin's
existing browser session won't see admin nav until they next log in), not something this stage needed to
fix since `SystemAdminGuard` re-checks the database on every request regardless.

**Not yet built**: `AI_TRANSCRIPTION` as an actually-wired key (the brief's own named example — Stage 8's
and Stage 26's services could each start checking a key at any time, no schema change needed, just wasn't
in this stage's chosen representative set), and a hosted flag service (LaunchDarkly-style) as a later swap
behind the same `FeatureFlagsService` interface once flag volume ever justifies it — explicitly noted as a
non-goal for this pass by the roadmap item itself.

## Organizations (Stage 28)

Second item of Priority 5. `Organization`/`Membership` already existed (Stage 2) with a minimal service —
create, list mine, add a member by known user id — but no invite flow, no member-management UI outside the
read-only system-admin dashboard, and the `storageLimitBytes`/`meetingConcurrencyLimit` fields on
`Organization` had sat unread since they were added. This stage builds the real version of all three.

**A real mail service, not a stub** — the most consequential discovery of this stage. `nodemailer` was
already a declared dependency in `apps/api/package.json`, and `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/
`SMTP_PASSWORD`/`SMTP_FROM`/`SMTP_SECURE` had all existed in `packages/config/src/env.ts` since before this
session — configured, validated, and never once used by any service. The same "real scaffolding waiting to
be wired up" shape this codebase has had before (`FileAsset`, `MeetingInvite`, `ChatRoom.photoUrl`). New
`MailService` (`apps/api/src/mail`) wraps `nodemailer.createTransport` over those exact env vars — no new
config surface invented, just finally read. Local dev already had a real inbox to send to: the
`docker-compose.yml` `mailhog` service. This meant "invite by email" could be, and was, verified against a
**genuine SMTP send** — read back through MailHog's own API in the live-verification driver — not merely
"the endpoint returned 200."

**`OrganizationInvite`**: a real invite-acceptance flow, distinct from the pre-existing `addMember` (which
adds someone immediately, no consent step, and requires already knowing their account id). Works whether
or not the invited email has an account yet — the email always contains the same accept link
(`/organizations/invites/:token`); an unauthenticated visitor is routed through register/login first
(`redirect=` query param, added to both pages this stage — a small, generically useful addition, not
invite-specific plumbing) and lands right back on the same accept page. `acceptInvite` only ever succeeds
if the now-authenticated account's email matches the invite's email **exactly** — a valid token alone
isn't sufficient, precisely so a forwarded or leaked invite link can't be redeemed by someone it wasn't
sent to. Re-inviting an already-`PENDING` email refreshes the row in place (new token, resent email) rather
than erroring, matching how most real products treat "invite someone twice."

Schema additions were otherwise straightforward: `OrganizationInvite` itself, and a new `ORG_INVITE`
`NotificationType` value (its own small migration) for notifying an invited email that already has an
account. `OrganizationInvite` deliberately has **no** unique constraint on `(orgId, email)` — Stage 27's
`FeatureFlag` table needed one (with the partial-index fix that stage found), but multiple past invites to
the same address over time (declined, expired, re-invited later) are legitimate history here, not a
conflict to prevent — the lesson from Stage 27 was applying the right constraint, not applying *a*
constraint everywhere invite-shaped data shows up.

**Real member management**: role changes are **owner-only**, not owner-or-admin — an admin promoting
another admin (or itself to owner) is exactly the privilege-escalation loop that restriction closes.
Removing a member, changing a member's role away from `OWNER`, and a member leaving on their own are all
independently protected against ever leaving an org with zero owners (`assertNotSoleOwnerRemoval`,
checked by counting `OWNER` memberships, not just checking the target's own role) — verified live by
confirming the sole owner's own `/leave` call genuinely 403s.

**Per-org limits, actually enforced at the point of the real action, not a separate checked-then-forgotten
call**: `MeetingsService.create` calls `OrganizationsService.assertMeetingConcurrencyOk(orgId)` whenever a
meeting is explicitly created under an org, counting genuinely `LIVE` meetings (not merely scheduled/
waiting) against `meetingConcurrencyLimit`. `FilesService.presignMeetingUpload` calls `assertStorageOk`
before minting a presigned URL, summing the org's `FileAsset.sizeBytes` — which meant fixing a real, related
gap found in the process: `FileAsset.orgId` had existed in the schema but was **never populated** by that
upload path, so any storage aggregate over it would always have read zero usage no matter how much was
actually uploaded. Now set from the meeting's own `orgId` at presign time. Deliberately scoped to the one
upload path with a size known up front (`FileAsset`), not server-side recordings — a recording's final size
isn't known until Egress finishes, and starting one is already host-gated; blocking it on a size estimate
would be different, larger work than this pass covers.

**Real UI**: `/organizations` (list + create) and `/organizations/:id` (roster, invite-by-email form with
its pending-invites list, role dropdowns, remove/leave) — genuinely member-facing, not the read-only
system-admin view. `/organizations/invites/:token` is the accept-invite page the email link actually opens.

19 new `OrganizationsService` unit tests (invite precedence and refresh, accept-invite email matching/
expiry/already-responded, sole-owner protection across all three removal paths, owner-only role changes,
both limit checks) plus 3 new `MeetingsService.create` tests for the concurrency check. Full API suite now
194 tests across 24 suites, typecheck/lint clean on `apps/api` and `apps/web`.

**Verified live** (`.run-driver/drive-organizations.js`, screenshots in `.run-driver/screenshots/
organizations/`) with two real people end to end: A creates a real org through the real UI, invites B (who
has no account at all) by email. The email genuinely arrives — confirmed by querying MailHog's own message
API directly, not trusting the app's own "sent" message — and the real accept token is extracted from the
real delivered email body (a quoted-printable soft-line-break gotcha in that extraction was itself a real
bug caught and fixed mid-drive, not a hypothetical). B follows that exact link, registers with the
pre-filled email, and lands back on the same accept page automatically; accepting creates a real
membership, visible to A after a refresh with no stale state. A promotes B to admin via the real dropdown,
confirmed by reloading and reading the control back. The sole-owner's own `/leave` call is confirmed
rejected (403) via a direct fetch, not just inferred from the UI. Both limits were flipped live via direct
SQL (this environment has no settings UI for them yet — a real, stated gap, not silently worked around) and
confirmed via real API calls on both sides of the threshold: blocked over the concurrency limit, allowed
under it; blocked over the storage limit (after correctly requiring the caller to actually be a meeting
participant first — creating a meeting doesn't join it), allowed under it. A finally removes B for real,
confirmed gone from the roster. The three console errors logged are exactly the three deliberately-
triggered negative-path fetches (the two limit rejections and the sole-owner-leave rejection), not bugs.

**Not yet built**: a settings UI to change an org's own `meetingConcurrencyLimit`/`storageLimitBytes` (only
adjustable via direct DB access today — this stage proved the *enforcement* works, not that an owner can
self-serve new limits, which would need its own billing-adjacent conversation this project's brief keeps
explicitly out of scope); the "New meeting"/"Schedule meeting" UI still doesn't expose picking which org a
meeting belongs to, so `orgId` in practice is only ever set via direct API use today, not the current
click-through flow — the limits are for real regardless, just not yet reachable from that specific screen.

## Teams (Stage 29)

Third item of Priority 5. A `Team` is an org-scoped sub-group with its own membership and its own real-time
chat room — the same relationship shape `ChatRoom`/`Meeting` already have to a `Class` (one dedicated chat
room per parent object, created alongside it, never shared). Deliberately distinct from a Team *Chat*
`GROUP` room (Stage 23): a Team is a persistent org sub-unit with roles (`LEAD`/`MEMBER`) and its own
membership lifecycle (join/leave/remove, sole-lead protection), not an ad-hoc multi-person conversation
someone assembled by hand.

**Almost no new chat backend, by design** — the entire point of confirming `ChatService`'s authorization
shape before writing a line of `Team` code. Every room-scoped method (`requireMember`, `roomHistory`,
`persistRoomMessage`, attachment presign/download, `markRoomRead`, edit/delete) only ever checks for a
`ChatMember` row against a given `chatRoomId` — never the room's `type`. `Team.create` creates its
`ChatRoom` with `type: TEAM` and seeds the creator's own `ChatMember` row in the same nested Prisma write;
`Team.join`/`leave`/`removeMember` keep a `TeamMember` row and its paired `ChatMember` row in sync inside a
`$transaction`. Once that sync holds, real send/receive/edit/delete/attachments/read-receipts all work on a
Team room with zero new endpoints — confirmed live, not just by reading the code. "Start a meeting" is the
identical client-side pattern Stage 23 shipped for Team Chat groups, reused verbatim: `POST /meetings` then
a `ROOM_MESSAGE` socket emit with the join link — no new backend endpoint for it either.

**Sole-lead protection**, the same shape as Stage 28's sole-owner protection: before demoting a `LEAD` to
`MEMBER`, removing a `LEAD`, or letting a `LEAD` leave on their own, `assertNotSoleLeadRemoval` counts the
team's other `LEAD` rows and 403s if the action would leave zero — verified live via direct fetches on both
sides of the boundary (demoting one of two leads: 200; demoting the resulting sole lead: 403; that same
sole lead leaving: 403).

**New frontend**: a "Teams" section on `/organizations/:id` (list as cards with member counts, inline
create form) and a new `/teams/:id` detail page — header (LEAD-only inline rename, member count, "Start a
meeting", join/leave, LEAD-only delete), a `TeamChatPanel` (deliberately v1-scoped exactly the way Stage
23 shipped group chat before Stage 24 layered on edit/forward/voice/typing — send/receive/edit/delete work
now, forward/voice/typing don't yet, though nothing server-side blocks adding them since it's the same
`ChatService` infrastructure), and a member sidebar with LEAD-only role/removal controls.

**Two real bugs found and fixed during live verification, not worked around**:
1. The member sidebar originally rendered a member's role badge *or* the LEAD-only management buttons,
   never both — so a LEAD looking at another member's row had no way to see that member's actual role
   except by inferring it from a button's current label. Caught because it broke a live assertion (checking
   for literal "LEAD" text in a promoted member's row from a LEAD's own view). Fixed by making the role
   badge always render, with the management buttons appended alongside it rather than replacing it — a
   real UI fix, not a test workaround.
2. `TeamChatPanel`'s socket message listener appended every incoming `ROOM_MESSAGE` unconditionally,
   without deduping by message id. React Strict Mode's dev-only double-effect-invocation surfaced this as
   a live "duplicate key" console warning (and a duplicated message bubble) during the drive. The
   already-shipped `chat/page.tsx` room listener has exactly this guard
   (`prev.some((m) => m.id === payload.id) ? prev : [...prev, payload]`) — this panel simply didn't carry
   it over when written. Added the same guard; the duplicate-key warning and duplicate bubble are gone on
   re-run.

16 new `TeamsService` unit tests (create's org-membership requirement and nested-write shape, join/leave
including the already-a-member conflict and sole-lead leave protection, member removal/role-change LEAD
requirement and sole-lead protection, update/delete LEAD requirement and soft-delete). Full API suite now
210 tests across 25 suites, typecheck/lint clean on `apps/api` and `apps/web`.

**Verified live** (`.run-driver/drive-teams.js`, screenshots in `.run-driver/screenshots/teams/`) with two
real people end to end: A registers, creates a real org, creates a real team through the real UI and is
shown as `LEAD`. B registers, is added to the org (Stage 28's already-verified flow, not re-tested here),
visits the team before joining and sees the chat panel genuinely locked behind a "Join this team" prompt.
B joins for real (`TeamMember` + `ChatMember` both created); A reloads and the two exchange live messages
over the actual socket room, each side receiving the other's message with no manual refresh. A promotes B
to `LEAD` via the real sidebar control, confirmed by reload. A clicks "Start a meeting" and is navigated to
a genuinely newly-created `/meeting/:code`; B sees that exact join link appear live in the team chat with
no action of their own. Sole-lead protection is confirmed on both sides of the boundary via direct fetches
(200/403/403, as above). Finally B — now the team's sole lead after A's earlier demotion — removes A from
the team for real; a `DELETE` request genuinely returns 200 and A no longer appears in the roster on
re-render, while A's earlier chat messages correctly remain in history unaltered (removing someone from a
team doesn't retroactively edit the room's message log — the first version of this assertion was itself a
false positive, from a page-wide `text=` selector matching A's name as it still appeared as a chat message
sender, not as a member row; fixed by giving the member `<ul>` a real `aria-label` and scoping every
member-row locator in the driver to it). The four console entries logged across both pages are exactly the
two deliberately-triggered negative-path 403 fetches (on B's side) and two `NotFoundError: Requested device
not found` entries (on A's side, from headless Chrome having no camera when "Start a meeting" navigates
into the meeting room) — not bugs.

**Not yet built**: forwarding, voice messages, and a typing indicator in `TeamChatPanel` (server-side
already supports all three on this room type — v1 UI scope trim only, the same shape as Stage 23→24); any
UI for reordering/archiving teams; and — same as Organizations — no click-through flow yet sets a Team's
`orgId` context when starting a meeting other than through the Team page itself.

## Custom branding (Stage 30)

Fourth item of Priority 5. `Organization.logoUrl`/`brandColor` had existed in the schema since Stage 2,
unread by anything — this stage is what finally reads them, plus one small schema addition
(`Organization.joinPageMessage`, a short welcome line) and a real theming layer, not just a settings form
that writes to columns nobody looks at.

**Deliberately extends `Organization` directly, not a new `OrganizationBranding` table** — the same call
Stage 28 already made for the per-org limits (`storageLimitBytes`/`meetingConcurrencyLimit` live as flat
columns, not a satellite settings model), and it matches how `logoUrl`/`brandColor` were already shaped.
`PATCH /organizations/:id/branding` is owner/admin (`requireManager`, the same bar as `addMember`) — this
is ordinary org configuration, not the privilege-escalation-sensitive kind of change Stage 28's
owner-only `updateMemberRole` guards against.

**Reused, not reinvented, the LiveKit retheme mechanism this app already had** — `globals.css` has
retheme'd `@livekit/components-styles`' default palette via `--lk-*` custom properties since early in this
project. A per-org brand color is applied as an inline-style override of that exact same
`--lk-accent-bg`/`--lk-control-active-bg` pair, scoped to the one `[data-lk-theme="default"]` wrapper
around the meeting join screen's `<PreJoin>` — when an org has a `brandColor`, its actual "Join meeting"
button (and every other themed PreJoin control) renders in that color; when it doesn't, the wrapper is
untouched and the app's own default applies.

**A real, previously-invisible bug found and fixed live, not papered over in the test** — verifying that
"the app's own default applies" turned up that it didn't: the unbranded join button rendered LiveKit's own
stock blue (`#1f8cf9`) instead of this app's intended brand blue (`#3b6fe0`). Cause: `globals.css`'s
`[data-lk-theme="default"]` retheme block and `@livekit/components-styles`' own `[data-lk-theme="default"]`
block have identical specificity, so the tiebreaker is source order — and the library's stylesheet, imported
at the page level (`import "@livekit/components-styles"` in `meeting/[code]/page.tsx`), lands after
`globals.css` in the document and silently won on every LiveKit surface, not just this new one. This app's
entire retheme of LiveKit's prefabs had been a no-op since it was written, just never caught because
LiveKit's blue and this app's brand blue are both "a blue" at a glance in a screenshot. Fixed by doubling
the attribute selector (`[data-lk-theme="default"][data-lk-theme="default"]`, a standard specificity-bump
trick) so the app's retheme wins regardless of import order — verified by asserting the exact computed
`background-color` on the real button, not just eyeballing a screenshot.

**Real UI**: a "Branding" section on `/organizations/:id` (owner/admin only) — logo URL, a native color
picker paired with a hex text input (both write the same state), a join-page message textarea, a live
preview swatch, save/persist feedback. The meeting join screen (`/meeting/:code`, reachable by guests with
no auth) renders the org's logo above the title and its message below it when the meeting's org has any
branding set.

4 new `OrganizationsService.updateBranding` unit tests (owner/admin requirement, partial-field writes,
explicit-null clears a field). Full API suite now 214 tests across 25 suites, typecheck/lint clean on
`apps/api` and `apps/web`.

**Verified live** (`.run-driver/drive-org-branding.js`, screenshots in `.run-driver/screenshots/
org-branding/`): A creates a real org, sets a real logo (an inline data-URI, to keep the drive independent
of outbound network access), brand color, and join message through the real settings UI, saves, and the
values survive a reload (genuinely persisted, not just component state). B — added as a plain `MEMBER` —
never sees the Branding section in the UI, and a direct `PATCH .../branding` from B is confirmed 403. A
creates a real org-scoped meeting (no click-through org picker in "New meeting" yet — same accepted gap
Stage 28/29 already documented, so this used a direct API call like those stages did) and a genuinely
unauthenticated guest browser context opens its join screen: the real logo and message render, and the
"Join meeting" button's actual computed `background-color` matches the org's brand color exactly (not
merely "a hex string is stored somewhere"). As a negative case, A's own personal (non-org) instant meeting,
started through the real "New meeting" dashboard button, shows no logo and its join button's computed
color is confirmed to be the app's own default accent — proving the override is genuinely scoped to
branded meetings only. The five console entries logged across A/B/guest are exactly the expected
`NotFoundError: Requested device not found` (headless Chrome previewing camera/mic on PreJoin screens, ×4)
and the one deliberately-triggered negative-path 403 (on B's side) — not bugs.

**Not yet built**: an image-upload flow for the logo (today it's a plain URL, same convention as
`User.avatarUrl`/`ChatRoom.photoUrl` — no presigned-upload pipeline for any of the three yet); applying org
branding anywhere beyond the meeting join screen (e.g. an org-scoped dashboard header) — the join screen was
chosen as the one surface where an external, often-guest audience actually benefits from seeing it, matching
how real products (Zoom, Meet) brand the join experience specifically; and the roadmap's original phrasing
of this item as "login-page copy" — this app has no per-org login page to brand (auth is one shared
`/login` regardless of org), so that was read as "the join screen's welcome copy," the closest real
equivalent, and implemented as `joinPageMessage`.

## Global search breadth (Stage 31)

Fifth item of Priority 5. `GET /search` (Stage 11) covered three categories — meetings, contacts, notes —
scoped to the caller. This stage adds six more: chat messages, files, recordings, transcripts, courses,
and classes/assignments. Each is a genuinely additive `Promise.all` branch, not a rearchitecture — exactly
as the roadmap predicted — and each reuses a visibility rule this codebase had already defined for that
model elsewhere, rather than inventing a new one: chat messages via `ChatMember` (the same type-agnostic
membership check `ChatService` uses everywhere, so a MEETING/CLASS/TEAM/GROUP/DIRECT room's messages are
all searchable the same way); files via uploader/meeting-participant/chat-member/class-teacher-or-student
involvement; recordings and transcripts via the exact meeting-involvement clause
`RecordingsService.listMine` already used for its "Recent recordings" home-page card; courses via
`CoursesService.listMine`'s existing definition; classes/assignments via `ClassTeacher`/`ClassStudent`.
Never a cross-user search — verified live, not assumed.

**Each new result category resolves its own real navigation target server-side** (a `href` field), rather
than pushing per-type routing logic onto the client: a chat-message or file result opens the exact room it
came from (`/meeting/:code`, `/classes/:id`, `/teams/:id`, or `/chat?room=:id`, resolved from the room's
real `type`); a recording opens `/recordings`; a transcript segment and a course/class/assignment each open
their real owning page.

**Recordings/transcripts were seeded via direct SQL for verification, not produced by a real recording** —
LiveKit Egress remains the documented, permanently-accepted gap this environment has had since Stage 7/26
(no egress container wired to actually record). Rather than skip these two categories, real `MeetingRecording`/
`MeetingTranscript`/`TranscriptSegment` rows were inserted directly against a real meeting a real user
owns, proving the search query, scoping, and href-resolution logic against rows shaped exactly like ones a
working Egress would eventually produce — the same honesty convention this project has used for every other
Egress-dependent gap, stated plainly rather than silently worked around.

13 new `SearchService` unit tests (scoping conditions for chat messages/files/recordings/courses/classes,
href-resolution priority for files with multiple possible contexts, href resolution per chat-room type).
Full API suite now 227 tests across 26 suites, typecheck/lint clean on `apps/api` and `apps/web`.

**Verified live** (`.run-driver/drive-global-search.js`, screenshots in `.run-driver/screenshots/
global-search/`) with three real people: A sends a real chat message and uploads a real file attachment in
a real GROUP room with B, creates a real course/class/assignment, and starts a real meeting (its
recording/transcript fixtures seeded as described above). Searching from A's own session surfaces all seven
new categories correctly labeled and linked — confirmed by clicking an actual chat-message result and
landing back in the real room, and an actual course result and landing on the real course page. B — a real
member of the chat room and nothing else — sees the chat message and file (real `ChatMember`-based access)
but genuinely does not see A's course, class, or recording (no relationship to any of them). C — related to
none of it — searches the same query and sees literally "No results", the dropdown's own real empty state,
not a UI that just happens to render nothing. Zero console errors on any of the three pages across the
entire run.

**Not yet built**: full-text ranking (every new category is the same ILIKE `contains` approach the original
three categories and Stage 8's per-meeting transcript search already used — ranked/fuzzy search would be a
follow-up, not something this pass changed); a dedicated `/search` results page (results only ever render in
the topbar dropdown, capped at 6-8 per category — there's no "see all results" page to page through more).

## Presence (Stage 32)

Sixth item of Priority 5. Stage 24's "online status v1" was a recency timestamp
(`User.lastSeenAt`, bumped on WebSocket connect, read back as "Online" within a 2-minute window or "Last
seen X ago") — real, but not live: two people who were both genuinely online right now looked identical to
someone who'd merely connected within the last two minutes, and there was no away/busy/DND concept at all.
This stage replaces the *online/offline* judgment with a real one and adds the three explicit statuses,
without touching `lastSeenAt` itself (still the honest fallback once someone's genuinely offline).

**`PresenceService`, Redis-backed, exactly where this repo's own `RedisModule` doc comment already said
presence would live.** Two keys per user: `presence:sockets:{userId}`, a Set of that user's currently
connected Socket.IO socket ids (multi-tab/multi-device correct by construction — a second tab closing
doesn't make the first tab's connection stop counting), and `presence:status:{userId}`, an explicit
AWAY/BUSY/DND override that only ever exists alongside a non-empty sockets set. Both carry a 120s TTL,
refreshed on every connect/heartbeat/status-change — not belt-and-suspenders over
`RealtimeGateway.handleDisconnect` firing (Socket.IO's own ping/pong keepalive already makes that fairly
reliable even for a crashed tab), but what actually protects against the case that matters more: the
*gateway process itself* crashing mid-connection, where `handleDisconnect` never runs at all and nothing
else would ever clear these keys. The client emits a `PRESENCE_HEARTBEAT` every 45s (mounted once, in
`AppShell`) purely to keep that TTL alive.

**Two channels for reading it back, deliberately different, both real**: a real-time push
(`PRESENCE_UPDATED`) to every `chatroom:{id}` a user belongs to whenever their status changes — the exact
"who's actually online right now in Team Chat" case this item named — and a bulk `GET /presence?userIds=`
REST endpoint, polled every 20s by the Contacts page. The split isn't arbitrary: a chat room is a real,
persisted channel to push into (the same `chatroom:{id}` reach `ROOM_UPDATED` already has — only clients
with that room open receive it), but "Contacts" has no persisted per-user relationship at all (it's
entirely derived from meeting co-participation, see `ContactsService`) — there's no channel to push a
presence change *into* for someone who merely shares meeting history with you, so polling while the page is
open is the honest v1 answer there, not an oversight.

**A full disconnect clears any explicit status** — reconnecting after a genuine offline period always
starts fresh at ONLINE rather than resuming whatever AWAY/BUSY/DND was set before going offline. A
deliberate v1 scope call (real products like Slack persist DND across reconnects with more machinery this
pass didn't build), stated plainly rather than silently different from expectation.

**A real bug found live, not papered over in the test**: verifying the OFFLINE transition showed a
definitively-offline user still reading as "Online" in the UI for up to two more minutes. Root cause: the
frontend's fallback text for "no live presence status" (`formatLastSeen`, Stage 24's own recency guess) was
being reused even in the branch where a real, certain OFFLINE status *was* already known — and
`handleDisconnect` bumps `lastSeenAt` to "now" the moment someone disconnects, so that old heuristic's own
2-minute "Online" window re-triggered immediately on the freshly-bumped timestamp. Fixed by splitting
`format-last-seen.ts` into `formatLastSeenPhrase` (always "Last seen X ago" — used whenever a real presence
status, even OFFLINE, is known) and `formatLastSeen` (the old recency guess, now correctly scoped to only
the narrow window before any real presence data has loaded at all).

**Real UI**: a colored status dot on the account-menu avatar (green/yellow/red/purple for
Online/Away/Busy/DND) with a picker to set it explicitly, in `AppShell` so it's on every authenticated page;
the same colored dot + label wherever presence was already shown (Contacts list, a DIRECT Team Chat room's
sidebar dot and header). GROUP rooms still only show a member *count* in the header, never per-member
presence — a deliberate v1 scope trim, not something this pass touched.

13 new `PresenceService` unit tests (connect/disconnect socket-set semantics, multi-tab correctness, TTL
heartbeat, explicit status set/clear, bulk lookup) against a minimal in-memory fake Redis client (no new
test dependency). Full API suite now 240 tests across 27 suites, typecheck/lint clean on `apps/api` and
`apps/web`.

**Verified live** (`.run-driver/drive-presence.js`, screenshots in `.run-driver/screenshots/presence/`) with
three real people. Team Chat push path: the moment B (already connected from registering) opens a DIRECT
room with A, A sees B's real ONLINE dot with zero reload; B sets Busy then Do Not Disturb via the real
account-menu UI and A sees both live; B's entire browser context is closed (a genuine crashed-tab-equivalent
disconnect, not a clean `socket.disconnect()`) and A sees B go OFFLINE live, correctly falling back to "Last
seen just now" — confirming the bug fix above, not just the happy path. Contacts poll path: A and C
genuinely join a real instant meeting together (fake media devices, real PreJoin click-through) to establish
a real co-participation record — since this sandboxed LiveKit `--dev` instance has no webhook configured
(the same documented, accepted gap Stage 26/31 already have), the resulting `MeetingParticipant` rows were
promoted from `ADMITTED` to `JOINED` via direct SQL to simulate what a working webhook would have done,
exactly as Stage 31 did for recordings/transcripts; C then shows up as Online on A's real Contacts page,
sets their own status to Away via the real UI, and A's page picks it up on its next real poll cycle — no
reload. Zero console errors across all three pages for the entire run.

Two bugs were caught and fixed mid-drive that turned out to be test artifacts, not product bugs, and are
recorded here because ruling that out took real diagnosis, not an assumption: a standalone `socket.io-client`
diagnostic (`socket.io.engine.close()`) initially seemed to show a user staying "online" forever after a
"disconnect" — turned out to be the client's own automatic reconnection racing back in with a new socket id,
correctly keeping the user online (a genuine network blip *should* look like nothing happened) — confirmed
by a second diagnostic using a real, full browser-context closure instead, which transitioned to OFFLINE
within seconds as expected. The meeting-join step failing for C also traced to real, correct app behavior
(the default `waitingRoomEnabled: true` meant C, not the host, needed manual admission) rather than a bug —
fixed by creating that one test meeting with `waitingRoomEnabled: false`.

**Not yet built**: per-member presence in a GROUP room's header (count only, as noted above); persisting an
explicit status across a full reconnect; a settings toggle for the heartbeat interval or presence TTL
(fixed constants for now, matching how most of this app's other tunables are handled at this stage).

## Moderation (Stage 33)

Seventh item of Priority 5. Three real, independent pieces: report-participant, block-participant extended
into a live meeting, and domain restrictions — each landing on infrastructure this codebase already had,
not a rearchitecture.

**Report-participant**: a new `Report` model + a real admin review queue (`/admin/reports`), explicitly
distinct from `AuditLog` (which records actions a moderator/admin actually *took*, never complaints
*raised* — see the schema's own doc comment on `Report`). `POST /meetings/:meetingId/reports` — reachable
by *any* real participant of that meeting, not just moderators, reusing `PermissionService.getParticipant`
for "were you actually there" rather than inventing a second check; deliberately not filtered to only
currently-ADMITTED status either, since reporting the person who got you removed is exactly a real use
case. `reportedUserId` xor `reportedGuestName` (never neither, never both) — a guest with no account still
gets a real, denormalized name snapshot on the report, the same pattern `ChatMessage.forwardedFromSenderName`
already established for "nothing to look up once the meeting ends." The admin queue (`GET`/`PATCH
/admin/reports`) is a genuinely new admin section, not folded into the existing content/audit views —
own controller, own nav item, and a real "Open reports" stat card on the admin dashboard linking straight
to it.

**Block-participant, extended into a live meeting**: reuses Priority 3's `BlockedUser` table and semantics
exactly — a new `ParticipantsService.block` does everything `remove` already does (LiveKit removal, status
`REMOVED`, audit log) plus a real `BlockedUser` row from the acting moderator to the target, via
`ContactsService.block`. That's a deliberate, real side effect, not an oversight: blocking someone out of a
meeting also blocks their DMs/calls with you from that point on, the same as blocking from Contacts already
does — "I never want to hear from this person again" is one action, not two. Guests can be removed the
normal way but not blocked (`BlockedUser` needs two real accounts; nothing to attach a block to once the
meeting ends). The join-time gate this powers is directional, not the existing symmetric `isBlocked` check
(`ContactsService.hasBlocked`, new) — specifically "has *this meeting's owner* blocked this joiner", so a
co-host's block doesn't retroactively wall someone out of the *owner's* other meetings, only the blocker's
own.

**Domain restrictions**: `MeetingSettings.allowedEmailDomains` (a bare-domain string array, empty = no
restriction), checked at join time right after the password check. The owner is always exempt; a guest is
refused outright once the list is non-empty (no account email to check against at all). Real settings UI:
the one place this app already had live settings-editing (`PersonalRoomSettingsModal`, PATCHing the same
`/meetings/:id/settings` every meeting uses) gained a comma-separated domain input — not a new settings
surface invented for this stage.

**A real, pre-existing bug found and fixed live, unrelated to any of the above three features but caught
by driving them**: the Participants panel was showing every participant's raw *email address* as their
display name, to everyone else in the meeting — `RealtimeGateway.onJoinMeeting` built each
`ParticipantPresencePayload` from `client.data.email` (the JWT's own email claim) rather than the
participant's real display name. Live-driving the Report flow (which needed to click a specific named row)
is what surfaced it — the panel read `modA981287@arutech.dev`, not `Mod A`. Fixed by resolving the real
`User.displayName` (or `guestName` for a guest, who has no `User` row at all) at the moment presence is
broadcast, with the email kept only as a last-resort fallback for the practically-impossible case of a
mid-session deleted account. A real privacy leak this codebase has had since presence was first written,
not something these three moderation features introduced — worth fixing regardless of which stage happened
to catch it.

12 new backend unit tests (`ReportsService`: participant-check, create, admin listing/filtering, resolve
with distinct resolve/dismiss audit actions — 8; `ParticipantsService.block`: capability requirement,
real removal, real `BlockedUser` creation, audit action, guest refusal — 5) plus 8 new
`MeetingsService.join` tests (domain allow/refuse, owner exemption, guest refusal, block allow/refuse,
owner never checked against their own block). Full API suite now 261 tests across 29 suites, typecheck/lint
clean on `apps/api` and `apps/web`.

**Verified live** (`.run-driver/drive-moderation.js`, screenshots in `.run-driver/screenshots/moderation/`)
with six real people. B reports A for Harassment with real details, from the real Participants panel, in a
real meeting with real (fake-camera) video tracks; a freshly-promoted real admin opens `/admin/reports`,
confirms the reporter/reported/reason/details/meeting all read back correctly, resolves it with a note, and
confirms it moves out of the Open filter and shows the note under Resolved. A blocks C from the same real
panel — confirmed by C's own page live-transitioning to the real "removed" screen, not just an API 200 — and
then confirmed the block genuinely outlives that one meeting: a brand-new meeting created by A afterward
refuses C's join with a real 403. Domain restrictions were set through the real personal-room settings UI,
confirmed persisted after a reload, then verified from both sides of the boundary: D (a real
`@restrict.dev` account) joins normally, E (a real but non-matching account) is refused with a real, visible
error at the lobby and never reaches the in-meeting state, and a genuine unauthenticated guest is refused
outright (403) via a direct join-as-guest call. The three console entries logged (on C's and E's pages) are
exactly the three deliberately-triggered negative-path 403s above — not bugs.

**Not yet built**: reporting/blocking from outside a live meeting (e.g. from Contacts or chat history — both
are meeting-scoped triggers only, matching where this item's brief anchored them); a UI for setting domain
restrictions on a non-personal (regular scheduled/instant) meeting — only `PersonalRoomSettingsModal` was
extended, since it's the one settings-editing surface that already existed; per-report escalation/priority
in the admin queue (every report is just OPEN/RESOLVED/DISMISSED, no severity field).

## Advanced analytics (Stage 34)

Eighth and final item of Priority 5. The roadmap's own brief for this item was explicit that it "needs
deciding what 'feature usage' means concretely... before building anything, to avoid collecting data
nobody ends up using" — so before writing a line of code, this stage picked a small, deliberate, named set
of six features (whiteboard, polls, quizzes, breakout rooms, recording, live captions), each reporting a
concrete, non-redundant signal genuinely distinct from the admin dashboard's existing aggregate counts
(Stage 9): not "how many whiteboards exist" but "what fraction of meetings actually used one."

**Almost zero new data collection — the whole point, not an incidental property.** Five of the six
features already had a real table recording genuine usage the moment someone actually used them
(`Whiteboard`, `Poll`/`PollResponse`, `Quiz`/`QuizAnswer`, `BreakoutRoom`, `MeetingRecording`) — every
number `AdminAnalyticsService.getFeatureEngagement` reports for those five is a plain Prisma
`count`/relation-filter aggregate over data that was already there for its own real reason, nothing new
retained. Live captions was the one gap: the caption *text* deliberately never touches this database (see
Stage 26's own architecture), so there was no durable record that captions were ever used at all — not
even a boolean. Rather than add a tracking table, `CaptionsService.start` now writes exactly one row into
the `MeetingEvent` table moderation actions (Stage 33) already log into (`type: "CAPTIONS_STARTED"`) — the
smallest possible addition, reusing existing infrastructure designed for precisely this kind of lightweight
signal, not a new collection surface.

**A real, previously-uncaught bug found and fixed live, unrelated to analytics itself but caught while
generating real quiz usage to verify it**: `QuizPanel` had no catch-up fetch on mount at all — unlike
`PollsPanel`, which calls `GET /polls` on load, Quiz only ever populated from a live `QUIZ_PUBLISHED`
socket event. A participant who wasn't already on the Quiz tab at the exact moment a question was
published — or who simply joined the meeting afterward — had no way to ever see it; nothing to refetch. The
existing `GET /quizzes` endpoint couldn't fill this gap either (a lightweight summary list — no `options`,
no `status` — built for a different, history-view consumer, not for resuming an in-progress quiz). Fixed
with a new `GET /meetings/:id/quizzes/active` (any participant, not just the teacher) returning the
current OPEN quiz in the exact same sanitized shape (`isCorrect`/`correctAnswerText` stripped) the
`QUIZ_PUBLISHED` broadcast already uses, so the client's existing handler could consume either one
identically — plus the one-line `useEffect` in `QuizPanel` actually calling it, mirroring the pattern
`PollsPanel` had already gotten right.

**Real admin UI**: `/admin/analytics` — six cards, each an adoption-rate percentage with a progress bar,
"N of M meetings," and a feature-appropriate volume line (polls/quizzes also show total responses/answers
and an average per poll/quiz — the closest real analogue to the roadmap's own "poll-response-rate"
example). A 7d/30d/90d window selector actually re-fetches, not a client-side filter over one fixed pull.
A real "Open reports" stat card was also added to the main admin Dashboard back in Stage 33 and remains —
this stage's own new surface is exclusively the six-feature engagement view.

10 new backend unit tests (`AdminAnalyticsService`: window scoping, rate computation, divide-by-zero
safety, avg-per-poll math, published-only filtering, captions-via-MeetingEvent — 6; `QuizzesService.getActive`:
participancy requirement, null-when-nothing-open, sanitized shape — 3; plus 1 new `CaptionsService` test for
the `MeetingEvent` write). Full API suite now 271 tests across 30 suites, typecheck/lint clean on
`apps/api` and `apps/web`.

**Verified live** (`.run-driver/drive-analytics.js`, screenshots in `.run-driver/screenshots/analytics/`)
with two real people genuinely using all six features in one real meeting: A opens the Whiteboard tab (the
real trigger for `WhiteboardService.getOrCreate`), publishes a real poll B actually votes on, publishes a
real quiz question B actually answers (confirming the catch-up-fetch fix — B reached the Quiz tab after
publish and still saw it), creates real breakout rooms with real auto-assignment, and starts live captions
for real — genuinely dispatched to this environment's actual running transcription-agent worker, not
mocked. Recording was seeded via direct SQL, the same documented, accepted Egress-not-configured-in-this-
sandbox gap Stage 26/31 already established, not a new one. A freshly-promoted real admin then opens
`/admin/analytics` and every one of the six cards reflects real, live numbers — checked as "did the rate
and counts genuinely move," not pinned to exact values, since this shared dev database already had 257
meetings and prior feature usage accumulated across this session's own earlier stages by the time this
draft ran (a good sign the aggregates are reading real history, not a clean-room fixture). The window
selector was confirmed to actually issue a new, successful request when switched. Zero console errors on
either page for the entire run.

**Priority 5 is now fully closed out** — all eight items done: Feature flags, Organizations, Teams, Custom
branding, Global search breadth, Presence, Moderation, Advanced analytics.

**Not yet built**: per-user (rather than per-meeting) engagement breakdowns — deliberately out of scope,
since per-user granularity is exactly the kind of data this stage's own brief warned against collecting
without a concrete reason; a trend view over time (only a point-in-time window total, no day-by-day
chart); exporting the analytics data.

