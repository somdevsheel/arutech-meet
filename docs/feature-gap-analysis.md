# Feature Gap Analysis — Advanced Features Request

Audited against the 50-section "Advanced Features" brief, section by section. Status is evidence-based —
each row cites the file(s) checked, not a guess from the section list alone. ✅ done and verified working
(built earlier, or built/fixed this session and confirmed live — see docs/roadmap.md and the entries below
marked "this session"), 🔶 partially built (real backend/schema with a UI or wiring gap, or vice versa), ❌
not built at all. See `docs/advanced-features-roadmap.md` for what happens next with the 🔶/❌ rows.

## 1. Advanced meeting features

| Item | Status | Evidence |
|---|---|---|
| Instant / scheduled meetings | ✅ | `MeetingsService.create`, `apps/web/src/components/dashboard/schedule-meeting-modal.tsx` |
| Recurring meetings | 🔶 | Corrected this session — was claimed ✅ but that overstated it. `MeetingsService.create` stores `recurrenceFrequency`/`recurrenceUntil` on the *one* `Meeting` row it creates; nothing anywhere ever populates `parentMeetingId` or materializes per-occurrence rows, and no UI exposes creating a RECURRING meeting at all (`schedule-meeting-modal.tsx` only ever sends `type: "SCHEDULED"`). What's real: one persistent room reused every occurrence (functionally "the same link every week"), and Stage 25's Calendar page projects that one rule into individual occurrence *dates* for display (`CalendarService.expandRecurrence`) — but that's a read-time view projection, not stored recurrence instances. Creating a RECURRING meeting is only reachable via the API directly today |
| Meeting templates | ❌ | No `MeetingTemplate` model or "save as template" flow anywhere |
| Password, waiting room, host controls, co-host, lock, remove/mute participant, request-to-unmute, disable camera, allow/deny screen-share/chat/recording, join-before-host | ✅ | `MeetingSettings` model + `PermissionService`/`packages/types/src/permissions.ts` capability matrix, `WaitingRoomPanel`, `ParticipantsPanel` |
| Automatic meeting end, meeting timer | ✅ | `MeetingsEventsService` (`room_finished` webhook ends the meeting), in-room elapsed timer (`meeting-room.tsx`) |
| Manual "End meeting for everyone" (host) | ✅ **(bug fix this session)** | `POST /meetings/:id/end` existed server-side but had no UI button at all — a host could only "Leave" (disconnect themselves; the meeting kept running for everyone else). Added a host-only toolbar control (armed on first click, fires on a second confirming click) plus a real `WS_EVENTS.MEETING_ENDED` broadcast the client was already fully wired to receive but the server never sent. See `docs/roadmap.md`'s write-up |
| Meeting info panel | ✅ **(this session)** | `meeting-info-panel.tsx` — click the meeting title/code (Zoom-style) to open it: invite-link copy, meeting-code copy, security summary (password/waiting-room on-off, honest E2EE caveat), current recording status. See `docs/roadmap.md` Stage 17 |

## 2. Advanced video features

| Item | Status | Evidence |
|---|---|---|
| Active speaker detection | ✅ | LiveKit's own `participant.isSpeaking`, used directly (`video-grid.tsx` Speaker view) |
| Gallery / Speaker / Spotlight view | ✅ **(this session)** | Rewrote `video-grid.tsx` off LiveKit's stock `GridLayout` — real Gallery/Speaker toggle; a screen share or pinned tile spotlights regardless of mode |
| Pin participant / multiple pinned | ✅ **(this session)** | `pinned: Set<string>` in `video-grid.tsx`, verified live with 2 real participants (screenshot evidence in `.run-driver/screenshots/two-person/`) |
| Hide non-video participants | ✅ **(this session)** | `hideNonVideo` toggle, filters placeholder tracks |
| Fullscreen | ✅ **(this session)** | Whole-grid and per-tile, native Fullscreen API |
| Picture-in-picture | ✅ **(this session)** | Per-tile, feature-detected (`document.pictureInPictureEnabled`) |
| Camera/mic/speaker device selection | ✅ | Pre-join lobby device pickers (existing, unchanged) |
| Video quality/resolution/frame-rate selection | ❌ | No UI; LiveKit's simulcast handles adaptive quality automatically but there's no manual override |
| Network quality indicator, connection status, reconnection | ✅ | `ConnectionQualityIndicator` (now on every tile — this session), LiveKit's own reconnect handling |
| Simulcast, adaptive bitrate, bandwidth optimization, low-bandwidth mode | 🔶 | Simulcast is LiveKit's default behavior (not explicitly configured/verified in this codebase); no explicit low-bandwidth mode toggle or audio-priority-under-poor-network logic |

## 3. Screen sharing

✅ Real WebRTC screen-share track through the SFU (`meeting-toolbar.tsx`'s `setScreenShareEnabled`), host
permission gating (`screen_share.self` capability), now correctly spotlighted in every view mode (this
session). Entire-screen/tab/window selection is the browser's own native picker (not app-controlled — this
is correct, not a gap: no browser exposes that choice to page JS). Screen-share audio: passed
`{audio: true}` already. Mobile screen sharing: Android real, iOS not (see §40).

## 4. Virtual background

✅ **Built and verified live.** Real segmentation via LiveKit's own first-party `@livekit/track-processors`
package (MediaPipe selfie segmentation over WebGL/WASM), plugged into the actual published local camera
track via `LocalVideoTrack.setProcessor()` — `use-virtual-background.ts` +
`virtual-background-panel.tsx`, a popover off the meeting toolbar's new "Background" button. Blur, four
generated gradient presets (no licensed stock photography available, so honestly abstract rather than
pretending to be office/nature photos), and a custom local-image upload (`URL.createObjectURL`, never sent
to a server — client-side only, so not synced across devices, which the panel says outright). Verified live
with a real headless-browser session: screenshots before/after visibly differ (blur softened the synthetic
test pattern's edges; the Ocean preset fully replaced the frame), confirming actual pixel processing is
happening, not a UI-only toggle. Not yet wired into the pre-join lobby (which still uses LiveKit's stock
`<PreJoin>` prefab) — only available after joining, via the toolbar.

## 5. Meeting chat

| Item | Status | Evidence |
|---|---|---|
| Public chat, persistence | ✅ | `ChatService.persistMessage`/`history`, `chat-panel.tsx` |
| Private participant chat | ✅ **(this session)** | Recipient picker in the chat panel ("To: Everyone ▾"); backend support (`isPrivate`/`toUserId`) already existed |
| Reply | ✅ **(this session)** | Quoted-message preview, updates live if the quoted message is later deleted — verified live (`.run-driver/screenshots/chat-features/`) |
| Reactions | ✅ **(this session)** | `POST`-free, WS-toggled (`WS_EVENTS.CHAT_REACTION`), grouped pills with counts, real endpoint added to `ChatService.toggleReaction` |
| File/image attachments | ✅ **(this session)** | Real presigned-upload pipeline on the previously-unused `FileAsset` schema (new `FilesService`/`FilesController`) — verified live with a real image upload, cross-participant delivery, and inline render |
| Link detection, timestamps, mentions | ✅ **(this session)** | Client-side, safe (tokenized rendering, never `dangerouslySetInnerHTML`) |
| Message deletion, host moderation | ✅ **(this session)** | Soft-delete (own message free; others requires `chat.delete_any_message`, audit-logged), live broadcast |
| Edit message | ✅ (Stage 24) | Own message only, `editedAt` shown; live broadcast (`WS_EVENTS.CHAT_MESSAGE_EDITED`) |
| Forward message | ✅ (Stage 24) | Meeting-chat or Team Chat source → any Team Chat room the caller is a member of; text-only in this pass (refused for attachment/voice-only messages) |
| Voice messages | ✅ (Stage 24) | `MediaRecorder`-recorded, uploaded as a `ChatAttachment` whose `mimeType` starts with `audio/` — no separate model |
| Typing indicator | ✅ (Stage 24) | `WS_EVENTS.CHAT_TYPING` (existed unwired before this stage) |
| Unread count, @everyone (notify-all) | ❌ | Panel-level unread isn't needed inside an already-open meeting chat (the toolbar's chat badge already covers "unread while on another tab"); `@everyone` currently just highlights as a mention like any other, doesn't trigger a distinct notification |

**Fully rebuilt this session** — see `docs/roadmap.md` §Advanced features Priority 1 continued for the
full write-up, including two real MinIO/network-environment bugs found and fixed while live-verifying
this (not app bugs — see that doc for what they were). Edit/forward/voice/typing (Stage 24) now apply to
Team Chat too, since it reuses the same `ChatService`/`ChatPanel`-adjacent code — see §24–26.

## 6. Participant management

✅ **(this session)** Panel now renders mic/camera/screen-share/hand-raised state (previously silently
always green/absent — the data existed in `ParticipantPresencePayload` but nothing rendered it), sorts
raised hands to the top, adds a host "Lower hand" action. Mute/disable-camera/remove/promote already
existed. Not built: demote co-host, "make host" (ownership transfer), send-private-message action (chat UI
gap above blocks this), and connection-quality per row (shown on video tiles instead, not the panel).

## 7. Raise hand and reactions

✅ **(this session), fully wired end-to-end**. Raise hand existed as dead code before this session — a
`raiseHand()` callback with no button calling it and no listener updating any state (verified by grep: zero
references to `HAND_RAISE`/`HAND_LOWER` in `meeting-room.tsx`/`meeting-toolbar.tsx` before this session).
Now: toolbar button, server-confirmed state (not local-only), sorts to top of participants panel, host can
force-lower. Reactions (👏👍❤️😂🎉😕🙌 — a representative set covering the brief's clap/like/love/laugh/
celebrate/confused/applause) are a new ephemeral `WS_EVENTS.REACTION` broadcast (mirrors the hand-raise
pattern — never persisted) rendered as floating emoji over the video area, auto-expiring. Verified live with
two real browser sessions — see `.run-driver/screenshots/two-person/08-a-hand-raised-reaction-sent.png`.

## 8. Breakout rooms

✅ Already complete (Stage 6) — create/rename via manual+auto assignment, move participants, broadcast,
join any room, close all. Not built: rename an existing room, per-room countdown timer (host can create/
close manually but there's no auto-close-after-N-minutes).

## 9. Recording

✅ Already complete (Stage 7, LiveKit Egress) — start/stop, status pipeline, playback, download, delete,
90-day expiration. Pause/resume: not supported (not a capability LiveKit's room-composite Egress exposes).
Local recording: ✅ **(this session)** — `local-recording-control.tsx`, a genuinely separate client-side
`MediaRecorder` path (canvas-composited video grid + mixed real audio, downloads a real `.webm` directly,
no host/Egress dependency, no server round-trip at all). Consent notification: ✅ **(this session)** — a
dismissible "This meeting is being recorded" banner, independent of the persistent header pill, for every
participant (including a joiner arriving after recording already started). See `docs/roadmap.md` Stage 18.

## 10. Recording library

🔶 `apps/web/src/app/recordings` lists recordings with search/playback/delete. Not built: the
My/Shared/Classes/Meetings sectioning, sort/rename, explicit "share with" UI (recordings are already
implicitly visible to everyone who attended the meeting — there's no additional sharing model beyond that).

## 11–13. Online classroom, attendance

✅ Already complete (Stage 6) — classes, students/teachers, real attendance derived from LiveKit presence
events, CSV export, screen share/whiteboard/polls/quizzes/breakout rooms all reachable from a class
session (which is just a `Meeting` with `type: CLASS`). Courses/batches: ✅ **(this session)** — a new,
purely additive `Course` model that a `Class` ("batch") can optionally belong to (`Class.courseId`,
nullable). See `docs/roadmap.md` Stage 19.

## 14–15. Whiteboard, polls

✅ Already complete (Stage 6) — real WS-synced canvas (pen/highlighter/eraser/text/shapes/sticky
notes/undo-redo/multi-page), live polls (single/multi-choice, timer, show/hide results). Anonymous
responses: not explicitly modeled (poll responses are tied to a user, not anonymized).

## 16. Quiz system

✅ Already complete (Stage 6) — MCQ, timer, points, automatic grading, per-student results, leaderboard.
True/false and short-answer question types: ✅ **(this session)** — see `docs/roadmap.md` Stage 20.

## 17. Assignments

✅ Built (Stage 16) — `Assignment`/`AssignmentSubmission` schema, due dates, real file attachments
(material and per-submission), text answers, resubmission (overwrites the same row, clears any prior
grade), teacher grading with score + feedback, notifications on post/submit/grade. See
`docs/roadmap.md` Stage 16.

## 18. Student/teacher dashboards

🔶 `apps/web/src/app/dashboard`, `apps/web/src/app/classes` exist and show upcoming classes, and the class
detail page now has a real Assignments section (§17 above). Still not the full section-by-section layout
described (no dedicated Tests/Study-Materials dashboard sections).

## 19–20. AI meeting assistant, AI classroom assistant

✅ AI meeting assistant complete (Stage 8, built two sessions ago — real OpenAI Whisper + GPT-4o-mini
pipeline, pluggable provider interfaces, transcript search, wired into the recordings panel). ✅ AI
classroom assistant **(this session)** — lecture notes, flashcards, practice questions, and a study guide
generated from a class session's transcript, reusing the same `SummarizationProvider` interface with a
different prompt/schema. Ships DRAFT with a mandatory teacher review-before-publish step (students never
see a draft — 404, not just a hidden UI element). See `docs/roadmap.md` Stage 21.

## 21–22. Live transcription, captions

✅ **Built (Stage 26)** — a real LiveKit Agents worker (`services/transcription`), host-triggered via a
toolbar "Captions" control, streaming per-speaker audio through OpenAI's Realtime STT and publishing
captions as LiveKit's own native room transcription (`useTranscriptions()`, `caption-bar.tsx`) — not the
client-side `SpeechRecognition` alternative this doc previously left open, which the roadmap item itself
called the architecturally weaker option for this product's ambitions. See `docs/webrtc.md` §Live captions
for the full design (including a real LiveKit-server read-API limitation found and worked around) and
`docs/roadmap.md`'s Stage 26 for live-verification evidence. Honest gap: no `OPENAI_API_KEY` was available
in this session's environment, so actual caption *text* wasn't live-verified — same limitation Stage 8's
AI meeting assistant already had; everything else (dispatch, the agent genuinely joining the right room,
host-only gating, the live "captions on" broadcast, clean start/stop) was.

## 23. Voice and video calls

✅ **Built and verified live.** Real ring/accept/reject/busy/cancel/missed/call-history on the
`Call`/`CallParticipant` schema (previously unused), a new `apps/api/src/calls` module, replacing
`ContactsService.call`'s old instant-meeting-plus-notification stand-in. Reuses the exact same
`<LiveKitRoom>` + `VideoGrid` the meeting room uses — no second media engine. Verified live with two real
registered users through the full state machine: outgoing ring → incoming modal → accept → real two-way
video → hang up → call again → cancel before answer → call again → decline → call history showing all
three with correct icons/direction/status. Zero console errors. 1:1 only for now (group calling is
schema-ready — `calleeUserIds` is already an array — but has no UI yet). This work also found and fixed
two real, previously-undiscovered bugs — see `docs/roadmap.md` for both; one of them (a client-side socket
singleton bug) likely affects the robustness of every other `user:{id}`-room feature too, including live
notification delivery.

## 24–26. Contacts, groups, personal chat

✅ Contacts (derived from real meeting history, Stage 11) plus block-user, contact groups, and favorites
**(this session)** — see `docs/roadmap.md` Stage 22. Block is enforced symmetrically at both call and DM
creation, not just hidden in the contacts UI. Team Chat groups: ✅ **(this session)** — group photo
(a URL, same convention as `User.avatarUrl`), group-level admins distinct from plain `ChatMember`
(promote/demote, admin-gated add/remove-member), and a "Start a meeting" group shortcut. See
`docs/roadmap.md` Stage 23 for why this is deliberately kept distinct from `ContactGroup` (Stage 22's
personal organizing label for contacts) despite the shared word "group," and for why the shortcut starts
a real N-person Meeting rather than building the separate, larger, still-not-built group-calling UI
(Stage 15's own "not yet built" list). Personal chat parity (§26): ✅ **(Stage 24)** — edit message,
forward message, voice messages, typing indicator, and online status ("last seen" v1, `User.lastSeenAt`)
now match §5's meeting-chat feature set, since Team Chat reuses the same `ChatService` and shares
`ChatPanel`'s components. Two real app bugs were found and fixed while live-verifying this (not
environment artifacts): (1) the server's MIME allowlist did an exact-string `Set.has()` check against the
browser-reported `mimeType`, which rejected every real voice message — Chrome's `MediaRecorder` reports
`audio/webm;codecs=opus`, not bare `audio/webm`; fixed with `isAllowedMimeType()` in
`file-upload.util.ts`, which strips the `;codecs=...` suffix before checking (the suffix is still stored
verbatim as the file's real MIME type). (2) The meeting-chat "Forward" picker labeled a `DIRECT` room by
`room.members[0]`, which is frequently the caller *themselves*, not the other person — cosmetically wrong
and, combined with a narrow test selector, initially masked the actual forward silently going nowhere;
fixed to find the member whose `userId !== currentUserId`, matching the pattern the real Team Chat page
already used correctly. Online status is deliberately a simpler v1 (see §37) — not the fuller presence
system Priority 5 describes.

## 27. File sharing

🔶 **Meeting chat attachments now real (this session), Team Chat attachments added Stage 24** — a genuine
`FilesService`/`FilesController` (`apps/api/src/files`) plus `ChatService`'s Team Chat-scoped
`presignRoomAttachment`/`getRoomAttachmentDownloadUrl` mirror, both built on the previously-unused
`FileAsset` schema (`FileScope.CHAT`, unused before Stage 24, is now wired up): presigned
direct-to-storage upload, server-enforced MIME allowlist, signed download URLs, `virusScanStatus` gating
(honest about no scanner being wired — see that service's doc comment). Still not reachable from Classes,
and no upload-progress UI (the presigned PUT is awaited in one shot rather than exposing incremental
progress) or expiration policy beyond what recordings already have.

## 28–29. Scheduling, reminders

🔶 **Calendar UI added (Stage 25)** — `GET /calendar/events` (`CalendarService`) merges scheduled meetings
and class sessions (two genuinely different sources: a meeting's own `scheduledStart` vs. a
`ClassSession.sessionDate`, since `ClassesService.createSession` never sets the underlying meeting's own
`scheduledStart`) into one list, rendered as real month/week/day views (`/calendar`) — click any event to
join the real meeting. A RECURRING meeting's single stored rule is projected into individual occurrence
dates for display (`CalendarService.expandRecurrence`), capped and fast-forwarded so a long-lived or
unbounded series can't blow up one request. Google/Outlook integration is architecture-and-stub only, as
scoped: a `CalendarProvider` interface (mirroring `SummarizationProvider`) with a `NullCalendarProvider`
that returns a real 503, not a fake "connected" state — no OAuth flow or token storage exists yet, that's
still genuinely new work. Still missing: any "class starts in 10 minutes" pre-event reminder job (only
post-event notifications — recording ready, transcript ready, chat message — exist today).

## 30. Notification center

🔶 Real, live (`NotificationsService`, topbar bell, unread badge, mark-read/mark-all-read — Stage 11). Not
built: the category breakdown (Meetings/Calls/Classes/Messages/Assignments/Tests/System as distinct
filterable groups — today it's one flat list) or a notification-preferences screen (documented gap already
in `docs/api.md`).

## 31–33. Organizations, teams, custom branding

✅ **Organizations built (Stage 28)** — a real, member-facing `/organizations` UI (distinct from the
system-admin dashboard's read-only view): create an org, a genuine invite-by-email flow (real SMTP send
via a new `MailService`, verified live via MailHog — not just an endpoint that returns 200), member
management (role changes, remove, self-service leave, all with sole-owner protection so an org can never
end up with nobody able to manage it), and per-org meeting-concurrency/storage limits actually enforced
server-side (not just stored on the `Organization` row — `MeetingsService.create` and
`FilesService.presignMeetingUpload` both check them for real). See `docs/roadmap.md` Stage 28.

✅ **Teams built (Stage 29)** — real `Team`/`TeamMember` models nested under `Organization` (sub-groups
within an org — Engineering/Sales/etc. — `LEAD`/`MEMBER` roles, sole-lead protection matching Stage 28's
sole-owner protection), each with its own real `ChatRoom`. Real-time chat (send/receive/edit/delete/
attachments), member management, and "Start a meeting" all work with **zero new chat backend** — `Team`
reuses the exact `ChatService`/`ChatMember` infrastructure Team Chat groups (§23–26) already use, since
that service only ever checks room membership, never the room's `type`. `/organizations/:id` now lists an
org's teams with inline create; `/teams/:id` is the team's own page (chat + member sidebar + Start a
meeting). See `docs/roadmap.md` Stage 29. Not yet built: forwarding/voice-messages/typing-indicator in the
team chat panel (v1 scope trim, same as Stage 23→24 — server-side already supports all three on this room
type).

✅ **Custom branding built (Stage 30)** — `Organization.logoUrl`/`brandColor` (existing since Stage 2) plus
a new `joinPageMessage` field, a real owner/admin settings UI (`/organizations/:id`'s "Branding" section:
logo URL, color picker + hex input, welcome message, live preview), and a real theming hook: the meeting
join screen (`/meeting/:code`, guest-reachable) shows the org's logo/message and themes the PreJoin "Join
meeting" button in the org's actual brand color via a scoped override of the same `--lk-*` custom
properties `globals.css` already retheme's LiveKit's prefabs with. That verification pass caught a real,
previously-invisible bug: the app's own LiveKit retheme had been silently losing a CSS specificity tie to
the library's own default stylesheet since it was written, so the "brand blue" was never actually
rendering anywhere until this stage's fix. See `docs/roadmap.md` Stage 30. Not yet built: a logo upload
flow (plain URL only, same as `User.avatarUrl` today); branding applied anywhere beyond the join screen.

## 34. Global search

✅ **Global search breadth built (Stage 31)** — `GET /search` (Stage 11: meetings/notes/contacts) now also
covers chat messages, files, recordings, transcripts (Stage 8's per-meeting `GET /meetings/:id/transcripts/
search` made cross-meeting and reachable from this one endpoint), courses, and classes/assignments — nine
categories total, each independently scoped to the caller's real involvement (`ChatMember`, meeting
ownership/participation, class teacher/student, course creator/enrollment), each resolving its own real
navigation target. Verified live with three people that the scoping is real: a chat-room member sees a
message/file from that room, a genuinely unrelated third person sees nothing across any category. See
`docs/roadmap.md` Stage 31. Not yet built: ranked/fuzzy search (still ILIKE `contains`, same as before);
a dedicated results page (topbar dropdown only, capped per category).

## 35–36. Meeting security, moderation

✅ Password, waiting room, lock, host approval, screen-share/chat/recording permission gating — all real,
server-enforced (`docs/security.md`).

✅ **Report-participant, block-participant, and domain restrictions built (Stage 33)** —
`POST /meetings/:meetingId/reports` (any real participant, reviewed at a real `/admin/reports` queue,
distinct from the audit log); `ParticipantsService.block` (reuses Priority 3's `BlockedUser` — a real
remove *plus* a real, directional block that gates the blocker's own future meetings, unlike a plain
remove which never prevented rejoining); `MeetingSettings.allowedEmailDomains`, checked at join time next
to the existing password check. Live verification of these three caught and fixed a real, pre-existing
bug: the Participants panel had been showing every participant's raw email address as their display name
to the whole meeting. See `docs/roadmap.md` Stage 33. Not yet built: disable-reactions/disable-file-sharing
as meeting-level settings; domain restrictions on a non-personal meeting (only the personal-room settings
UI was extended).

## 37. User presence

✅ **Real presence built (Stage 32)** — `PresenceService`, Redis-backed, derived from actually-open
Socket.IO connections (a Set of connected socket ids per user) plus an explicit AWAY/BUSY/DND override,
superseding Stage 24's recency-timestamp "online status v1" for the online/offline judgment itself (
`User.lastSeenAt` remains the honest fallback once someone's genuinely offline). Pushed live
(`PRESENCE_UPDATED`) to every Team Chat room a user belongs to; polled (`GET /presence`, every 20s) for
Contacts, which has no persisted per-user channel to push into. A colored status dot + picker lives in the
account menu on every authenticated page. Live verification caught and fixed a real bug: a
definitively-OFFLINE user still read as "Online" for up to two minutes, from Stage 24's own recency
fallback text being reused even once a real status was already known — see `docs/roadmap.md` Stage 32. Not
yet built: per-member presence in a GROUP room's header (member count only); persisting an explicit status
across a full reconnect (always resets to ONLINE). What exists beyond this remains meeting-scoped only:
`ParticipantPresencePayload` (mic/camera/hand-raised inside a meeting).

## 38. Device management

✅ Already complete — `GET /users/me/sessions`, Settings page "Active sessions" list (userAgent, last
active), logout-this-device and `AuthService.logoutAll` ("logout of all devices").

## 39. Profile

✅ Already complete — display name, username, avatar, timezone, language fields exist and are editable in
Settings (per `docs/database.md`'s `User`/`profiles` fields). Bio: not confirmed as a distinct field —
worth a quick follow-up check, not re-verified in this pass.

## 40. Mobile experience

Unchanged this session (no mobile files touched) — carrying forward `apps/mobile/README.md`'s own honest
accounting: real native app (not a WebView), core loop + live pre-join camera preview + waiting-room admit
+ Android screen share all real. Gaps: no iOS screen share (needs a native Broadcast Upload Extension,
Xcode-only), push notifications are architecture-only (no FCM/APNs wiring), no Bluetooth-audio-specific
handling documented, no background/lock-screen call handling, not build-verified on iOS (no macOS/Xcode
available in this environment).

## 41. Accessibility

🔶 Standard semantic HTML/ARIA from Tailwind + native `<button>`/`<dialog>`-style patterns throughout;
no dedicated accessibility audit, no captions (blocked on §22), no adjustable-text-size or
high-contrast-mode setting.

## 42–43. Performance, reliability

✅ WebSocket reconnection, WebRTC reconnection (LiveKit's own), graceful meeting-state recovery on
rejoin — all real, pre-existing. This session's video-grid rewrite was verified to not regress bundle size
(`/meeting/[code]` route: 178kB → 175kB First Load JS, per `pnpm build` output) despite replacing the
stock `GridLayout` with custom rendering.

## 44. Analytics

✅ **Feature-engagement analytics built (Stage 34)** — `/admin/analytics` reports adoption-rate-of-meetings
for six concrete features (whiteboard, polls, quizzes, breakout rooms, recording, live captions), distinct
from Stage 9's aggregate counts. Almost zero new data collection: five of the six are plain aggregates over
tables that already existed; live captions (whose text never touches this database) got exactly one new
`MeetingEvent` row per real start, reusing the same table Stage 33's moderation actions log into. Live
verification caught and fixed a real, unrelated bug: `QuizPanel` had no catch-up fetch on mount at all, so
a participant who reached the Quiz tab after a question was published could never see it. See
`docs/roadmap.md` Stage 34. **Priority 5 is now fully closed out.**

## 45–46. Admin dashboard, audit logs

✅ Already complete (Stage 9) — Users, Organizations, Meetings, Classes, Recordings, Audit Logs, dashboard
stats, system health, all backed by real queries. Not built: a dedicated Calls admin view (calls aren't a
first-class feature yet — see §23), a dedicated Reports export UI, and a moderation/abuse queue beyond
user suspend (documented gap already in `docs/roadmap.md` Stage 9).

## 47. Feature flags

✅ **Built (Stage 27)** — a real `FeatureFlag` table (`key`, `enabled`, optional `organizationId` for a
per-org override), `FeatureFlagsService.isEnabled`/`isEnabledForMeeting`, and a real admin UI
(`/admin/feature-flags`) to toggle them — no new SaaS dependency, per the roadmap item's own scoping. A
key with no row at all defaults to **enabled**, on purpose: everything already shipping before this system
existed was unconditionally on, so introducing flags must never silently turn one off for a key nobody has
configured. Three flags are actually wired to a real, server-enforced gate today (not just the admin UI):
`WHITEBOARD`, `BREAKOUT_ROOMS`, `LIVE_CAPTIONS` — verified live to genuinely block/allow the underlying
action, not just hide a button. See `docs/roadmap.md`'s Feature flags stage for the full design, including
a real Postgres constraint subtlety it hit (NULL isn't unique-comparable to NULL, so "at most one global
row per key" needed two partial unique indexes, not one plain composite `@@unique`).

## 48. Database

Every genuinely new entity this brief lists that doesn't already exist maps to a specific missing feature
above (assignments, teams, feature flags, calendar events as a distinct model, block-list, presence). No
schema changes were made this session — the two real bugs fixed (video-tile control overlap, participant
roster snapshot) were both pure application-logic fixes, no migration needed.

## 49. No monetization

Confirmed: nothing pricing/billing/subscription/payment-related was touched or added this session. One
correction to make here honestly rather than glossing over it: a `Subscription`/`SubscriptionPlan`/
`SubscriptionStatus` schema placeholder (with a `provider` field defaulting to `"stripe"`) already existed
in `packages/database/prisma/schema.prisma` *before* this session — a data-model shape reserved for
future billing, matching the original build brief's "Billing / Subscription Architecture" module. It has
**zero functional code behind it**: no Stripe (or any payment provider) API calls, no billing
controller/service, no checkout flow, nothing reachable from the app. Per this brief's explicit instruction
not to add monetization, it was left exactly as found — not extended, not wired up, not removed.
