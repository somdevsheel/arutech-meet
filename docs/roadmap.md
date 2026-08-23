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

