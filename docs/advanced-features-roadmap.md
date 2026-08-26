# Advanced Features Roadmap

Staged plan for closing the gaps in `docs/feature-gap-analysis.md`, in the priority order the brief itself
specifies. Each stage lists what's real backend/schema already (so scope is accurate, not guessed) and
what's actually new work.

## Priority 1 — Advanced meeting controls, participant management, screen sharing, chat, recording,
reconnection, network quality

**Done this session** (see `docs/roadmap.md` for the full write-up and live-verification evidence):

- Video grid rebuilt off LiveKit's stock `GridLayout`/`ParticipantTile` into custom `video-grid.tsx` +
  `video-tile.tsx`: real Gallery/Speaker view switching, multi-participant pin, hide-non-video-participants,
  per-tile and whole-grid fullscreen, per-tile Picture-in-Picture.
- Raise hand fixed from dead code (button existed nowhere, no listener updated state) to fully working:
  toolbar control, server-confirmed state via `WS_EVENTS.HAND_RAISE`/`HAND_LOWER`, sorts to top of the
  participants panel, host can force-lower someone else's hand.
  ~ Emoji reactions (👏👍❤️😂🎉😕🙌) — new ephemeral `WS_EVENTS.REACTION` broadcast (never persisted, same
  pattern as hand-raise), floating-over-video UI with auto-expiry.
- Participants panel now renders live mic/camera/screen-share/hand-raised state (the data already existed
  in `ParticipantPresencePayload`; nothing rendered it before).
- Two real bugs found and fixed via live two-browser verification (not just code review — see
  `.run-driver/drive-two-person.js` and its screenshots): a tile-hover-controls/grid-controls click-target
  overlap, and participants who join a meeting after others were previously invisible in the *joiner's own*
  Participants panel (`RealtimeGateway.onJoinMeeting` never sent a roster snapshot, only future joins).

**All four items originally listed here are now done** (this section is kept, corrected, for a record of
what was planned vs. what shipped — see `docs/roadmap.md` for each stage's live-verification evidence):

1. ~~Meeting chat rewrite~~ — done, Stage 13. Reply, private DM, reactions, real file/image attachments,
   timestamps, link/@mention rendering, soft-delete — all built and verified live with two real users.
2. ~~Meeting info panel~~ — done, Stage 17. Invite-link copy, security summary (password/waiting-room
   on-off, honest E2EE caveat), current recording status — reachable by clicking the meeting title.
3. ~~Recording consent banner~~ — done, Stage 17. The persistent header pill alone was explicitly not
   sufficient (a participant not looking at that instant would never see recording start) — added an
   explicit, momentary "This meeting is being recorded" banner, independent of the always-on pill, for
   every participant including one who joins after recording is already in progress.
4. ~~Local recording~~ — done, Stage 18. Client-side `MediaRecorder` capturing the composited video grid
   and mixed real audio, downloadable directly as a `.webm`, entirely separate from server-side Egress.

**Priority 1 is now fully closed out.**

## Priority 2 — Classroom, attendance, whiteboard, polls, quizzes, breakout rooms

Classroom/attendance/whiteboard/polls/quizzes/breakout rooms are **already real and complete** (Stage 6).
What's left here is course-structure modeling, not classroom mechanics:

1. ~~Assignments~~ — done, Stage 16. `Assignment`/`AssignmentSubmission` models, teacher create/review,
   student submit/resubmit, file attachment, score + feedback.
2. ~~Courses/Batches~~ — done, Stage 19. Went with the additive option this item itself floated rather
   than a forced `Course` → `Batch` → `Class` (session) re-hierarchy: a new, optional `Course` model that
   a `Class` ("batch") can belong to (`Class.courseId`, nullable) — a `Class` on its own is still exactly
   what it always was, grouping under a `Course` is opt-in. See `docs/roadmap.md` Stage 19 for why: the
   existing `Class` already *is* "one batch" (one fixed roster, one teacher set, its own sessions) — what
   was actually missing was only the shared-curriculum layer above it, not a rebuild of `Class` itself.
3. ~~Quiz question types~~ — done, Stage 20. True/false and short-answer, alongside the existing MCQ.
4. ~~AI classroom assistant~~ — done, Stage 21. Lecture notes/flashcards/practice questions/study guide,
   reusing the Stage 8 `SummarizationProvider` interface with a different prompt + JSON schema, shipping
   DRAFT with a mandatory teacher review-before-publish step, exactly as this item anticipated.

**Priority 2 is now fully closed out.**

## Priority 3 — Calls, contacts, groups, personal chat, file sharing, calendar

1. ~~Calls~~ — done, Stage 15 (this item's write-up predates that stage and was never updated to reflect
   it — corrected now). Real 1:1 ring/accept/reject/busy/cancel/missed + call history on the
   `Call`/`CallParticipant` schema, `WS_EVENTS.CALL_INCOMING`/`CALL_ACCEPTED`/`CALL_REJECTED`/`CALL_ENDED`,
   `CallOverlay` reusing the same `<LiveKitRoom>`/`VideoGrid` the meeting room uses — no second media
   engine. Two real bugs found and fixed live (a client socket-singleton reconnect race, and a 1:1 call's
   non-hanger-up side never getting marked `LEFT`) — see `docs/roadmap.md` Stage 15. Group-calling UI is
   the one piece explicitly left for later (backend already accepts multiple `calleeUserIds`; no client UI
   for it yet) — Stage 23's group "Start a meeting" shortcut deliberately used a real Meeting instead of
   building that UI, for the reasons given there.
2. ~~Contacts~~ — done, Stage 22. Block user (symmetric — either direction blocks both — checked at call
   initiation and DM creation; meeting invite has no targeted-invite endpoint to check in this codebase,
   noted honestly rather than invented), contact groups, favorites.
3. ~~Groups~~ — done, Stage 23. Went with the lighter option this item itself floated: `ChatRoom` gained
   `photoUrl`, `ChatMember` gained `isAdmin`, rather than a new `Group` model. Group meeting/call shortcut
   is a "Start a meeting" button (a real, already N-person-capable Meeting) rather than a new group-calling
   UI on top of Calls — see `docs/roadmap.md` Stage 23 for why.
4. ~~Personal chat parity gaps~~ — done, Stage 24. Edit message, forward message (text-only v1, denormalized
   sender-name snapshot rather than a live pointer to the source), voice messages (`ChatAttachment` with an
   `audio/*` `mimeType`, no separate type/model), typing indicator (`WS_EVENTS.CHAT_TYPING` wired up), and
   online status as the simpler "last seen" v1 this item itself anticipated (`User.lastSeenAt`, bumped on
   WebSocket connect — not Priority 5's fuller live-presence system). Two real bugs found and fixed live —
   see `docs/roadmap.md` Stage 24.
5. ~~Calendar~~ — done, Stage 25. Real month/week/day views (`GET /calendar/events?from=&to=`) merging
   scheduled meetings and class sessions — two genuinely different scheduling fields
   (`Meeting.scheduledStart` vs. `ClassSession.sessionDate`), not one query. A RECURRING meeting is
   projected into individual occurrence dates at read time (`CalendarService.expandRecurrence`), since it's
   stored as one rule, not per-occurrence rows — found and corrected a stale "done" claim about recurring
   meetings while scoping this (see `docs/roadmap.md` Stage 25 and `docs/feature-gap-analysis.md` §1).
   Google/Outlook integration is exactly the architecture-and-stub this item asked for: a `CalendarProvider`
   interface + `NullCalendarProvider`, a real 503 rather than a full two-way sync.

**Priority 3 is now fully closed out** — including item 1 (Calls), whose entry above had gone stale after
Stage 15 shipped it and was corrected alongside this item.

## Priority 4 — AI meeting assistant, AI classroom assistant, live transcription, captions

- AI meeting assistant: **done** (Stage 8, two sessions ago).
- AI classroom assistant: see Priority 2 item 4 above.
- ~~Live transcription and captions~~ — done, Stage 26. Went with option (a) this item itself identified as
  architecturally correct: a real LiveKit Agents worker (`services/transcription`), host-dispatched into a
  meeting's room, one streaming STT connection per speaking participant (not one per room — the framework's
  higher-level voice-assistant stack assumes a single linked participant, wrong for a multi-party meeting,
  so this uses the lower-level `Room`/`STT` primitives directly instead). Captions are published as
  LiveKit's own native room transcription (real per-segment `language` field, satisfying this item's
  multilingual-readiness note structurally) rather than a custom event on this app's own gateway. A real
  LiveKit-server read-API limitation was found and worked around live, not glossed over — see
  `docs/webrtc.md` §Live captions. Honest gap: no `OPENAI_API_KEY` in this session's environment, so actual
  caption text wasn't live-verified — same limitation Stage 8 already had; everything else was.

**Priority 4 is now fully closed out.**

## Priority 5 — Organizations, teams, custom branding, global search, advanced analytics, admin tools

1. ~~Feature flags~~ — done, Stage 27. Exactly the design this item floated: a `FeatureFlag` table (`key`,
   `enabled`, optional `organizationId` override), `FeatureFlagsService.isEnabled`/`isEnabledForMeeting`
   checked server-side wherever a gated action starts (mirrors `PermissionService`), no new SaaS
   dependency. Wired to a real gate for `WHITEBOARD`, `BREAKOUT_ROOMS`, and `LIVE_CAPTIONS` (not the
   brief's `AI_TRANSCRIPTION` example specifically, though that's a straightforward follow-up — any
   service can start checking a key at any time without a schema change). A real admin UI
   (`/admin/feature-flags`) to toggle global/per-org state, verified live to actually block the underlying
   action (a direct API call, not just a hidden button) and correctly default an unconfigured key to
   enabled. See `docs/roadmap.md` Stage 27.
2. ~~Organizations~~ — done, Stage 28. A real invite-by-email flow with genuine SMTP delivery (a new
   `MailService`, `nodemailer` + the `SMTP_*` env vars that had existed unused since before this session),
   a real member-facing management UI (distinct from the system admin dashboard's read-only view) with
   role changes/removal/self-service-leave all protected against ever leaving an org with zero owners, and
   per-org meeting-concurrency/storage limits actually enforced at the point of the real action
   (`MeetingsService.create`, `FilesService.presignMeetingUpload`) rather than just sitting on the
   `Organization` row unread.
3. ~~Teams~~ — done, Stage 29. New `Team`/`TeamMember` models nested under `Organization` (`LEAD`/`MEMBER`
   roles, sole-lead protection mirroring Stage 28's sole-owner protection), each with its own `ChatRoom` —
   same relationship shape `ChatRoom`/`Meeting` already have to a `Class`. Real send/receive/edit/delete/
   attachments/"Start a meeting" all worked with **zero new chat backend**, confirmed live, because
   `ChatService`'s room-scoped methods only ever check `ChatMember` existence, never room `type` — the
   entire design bet of this stage. Two real bugs found and fixed live: a member sidebar that hid a
   member's role badge whenever the LEAD-only management buttons showed (badge and buttons were wrongly
   mutually exclusive), and a missing dedupe-by-id guard on the team chat panel's socket listener (already
   present in the pre-existing `chat/page.tsx` listener, just not carried over) that let React Strict
   Mode's dev-only double effect produce a duplicated message. See `docs/roadmap.md` Stage 29.
4. ~~Custom branding~~ — done, Stage 30. Extended `Organization` directly (`logoUrl`/`brandColor` already
   existed unread since Stage 2; added `joinPageMessage`) rather than a separate `OrganizationBranding`
   table — same "extend the row" call Stage 28 made for per-org limits. The theming layer is exactly the
   mechanism this item predicted: a per-org `brandColor` overrides the same `--lk-*` custom properties
   `globals.css` already retheme's LiveKit's prefabs with, applied as a scoped inline-style override on the
   meeting join screen. Verifying that reuse surfaced a real, previously-invisible bug: the app's own
   `--lk-*` retheme had been silently losing a CSS specificity tie to LiveKit's own default stylesheet since
   it was written (both declare `[data-lk-theme="default"]` with equal specificity; source order favored the
   library), so the "brand blue" everyone assumed was live had actually never been rendering anywhere — fixed
   with a specificity bump, not worked around in the test. "Login-page copy" was read as the meeting join
   screen's welcome message (`joinPageMessage`) since this app has no per-org login page to brand.
5. ~~Global search breadth~~ — done, Stage 31. `SearchService` now also queries chat messages, files,
   recordings, transcripts (Stage 8's per-meeting transcript search made cross-meeting and reachable from
   the one global `/search` endpoint), courses, and classes/assignments — six additive query branches, each
   reusing a visibility rule this codebase already defined elsewhere (`ChatMember` for chat/files,
   `RecordingsService.listMine`'s meeting-involvement clause for recordings/transcripts,
   `CoursesService.listMine`'s definition for courses, `ClassTeacher`/`ClassStudent` for classes/
   assignments) rather than inventing new ones. Each result resolves its own real navigation target
   server-side. Verified live with three people that scoping is real, not just "search returns rows":
   a room member sees a chat message/file, an unrelated third person sees nothing at all.
6. ~~Presence~~ — done, Stage 32. `PresenceService`, Redis-backed exactly as this item predicted (`RedisModule`'s
   own doc comment already named "presence" as a use case) — a Set of connected socket ids per user
   (multi-tab correct) plus an explicit AWAY/BUSY/DND override, both TTL'd and heartbeat-refreshed so a
   crashed gateway process (not just a crashed tab) can't strand someone "online" forever. Pushed live
   (`PRESENCE_UPDATED`) to every Team Chat room a user belongs to; polled for Contacts, which has no
   persisted per-user channel to push into (it's entirely derived from meeting co-participation). Live
   verification caught and fixed a real bug: a definitively-OFFLINE user still read as "Online" for up to
   two minutes, because the old recency-based fallback text was reused even once a real, certain status was
   already known.
7. ~~Moderation~~ — done, Stage 33. Report-participant: a real `Report` model + a real admin review queue
   (`/admin/reports`), distinct from the audit log (actions taken, not complaints raised). Block-participant:
   `ParticipantsService.block` reuses Priority 3's `BlockedUser` exactly (removal + a real block, with the
   real side effect of also blocking DMs/calls from that point on), checked directionally at join time so
   only the *meeting owner's* own block gates their own future meetings. Domain restrictions:
   `MeetingSettings.allowedEmailDomains`, checked right after the existing password check, owner always
   exempt, guests refused outright once set. Live verification of these three also caught and fixed a real,
   pre-existing bug unrelated to any of them: the Participants panel had been broadcasting every
   participant's raw email address as their display name to the whole meeting since presence was first
   written.
8. ~~Advanced analytics~~ — done, Stage 34. Six concrete features (whiteboard, polls, quizzes, breakout
   rooms, recording, live captions), each reporting real adoption-rate-of-meetings and a feature-appropriate
   volume figure — decided deliberately, per this item's own instruction, before writing any code. Almost
   zero new data collection: five of the six are plain aggregates over tables that already existed for
   their own real reason; live captions (whose text deliberately never touches this database) got exactly
   one new `MeetingEvent` row per real start, reusing the same table Stage 33's moderation actions already
   log into rather than a new tracking surface. Live-verifying it caught and fixed a real, unrelated bug:
   `QuizPanel` had no catch-up fetch at all, so a participant who joined the Quiz tab after a question was
   published could never see it.

**Priority 5 is now fully closed out** — all eight items done.

## What this roadmap deliberately does not include

Pricing/billing/subscriptions/payments — explicitly out of scope per this brief, and the pre-existing
`Subscription` schema placeholder (see `docs/feature-gap-analysis.md` §49) should stay exactly as inert as
it already was found.
