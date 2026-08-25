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

1. **Feature flags**: the brief's own list (`AI_TRANSCRIPTION`, `WHITEBOARD`, `BREAKOUT_ROOMS`, etc.) maps
   cleanly onto a small `FeatureFlag` table (`key`, `enabled`, optional `organizationId` for per-org
   overrides) + a `FeatureFlagService.isEnabled(key, orgId?)` guard, checked server-side wherever a gated
   action starts (mirrors how `PermissionService` is already consulted everywhere — same shape of problem).
   No new SaaS dependency needed for a first version; a hosted flag service (LaunchDarkly-style) is a valid
   later swap once flag volume justifies it, kept behind the same interface.
2. **Organizations**: invite-by-email flow, a real member-management UI (today only the system admin
   dashboard can see orgs, read-only), per-org meeting/storage limits actually enforced (not just stored).
3. **Teams**: new `Team`/`TeamMember` models nested under `Organization`, with their own chat/meetings/
   files — same relationship shape `ChatRoom`/`Meeting` already have to a `Class`, extended to a `Team`.
4. **Custom branding**: `OrganizationBranding` (logo URL, brand color, login-page copy) + a theming layer
   that overrides the CSS custom properties this app already uses for its own design tokens (see
   `globals.css`'s `--lk-*` variables for the exact mechanism already in place for LiveKit's own
   components — the same technique applies to the app's own brand tokens).
5. **Global search breadth**: extend `SearchService` to also query chat messages, files, recordings,
   transcripts (per-meeting transcript search already exists — Stage 8 — this is making it
   cross-meeting and reachable from the one global `/search` endpoint), courses, assignments — each is an
   additive `OR` branch in a query that's already structured for this, not a rearchitecture.
6. **Presence** (online/away/busy/DND): the one piece several other gaps depend on (contacts online status,
   "who's actually online right now" in Team Chat). A `Redis`-backed presence set (already the documented
   use for "presence" per this repo's own architecture doc) keyed by `userId`, updated on
   connect/disconnect/explicit-status-change, TTL'd so a crashed tab doesn't strand someone "online"
   forever — this is exactly the kind of ephemeral, fast-changing state Redis is already used for elsewhere
   in this codebase (rate limiting, distributed locks).
7. **Moderation**: report-participant (a new lightweight `Report` model + admin queue, distinct from the
   existing audit log, which records actions taken, not complaints raised), block-participant (reuses
   Priority 3's `BlockedUser`, extended to also apply inside a live meeting), domain restrictions
   (an allow-list field on `MeetingSettings`, checked at join time next to the existing password check).
8. **Advanced analytics**: per-feature engagement, distinct from the admin dashboard's existing aggregate
   counts — needs deciding what "feature usage" means concretely (e.g. whiteboard-opened count,
   poll-response-rate) before building anything, to avoid collecting data nobody ends up using, per the
   brief's own "do not collect unnecessary personal data" instruction.

## What this roadmap deliberately does not include

Pricing/billing/subscriptions/payments — explicitly out of scope per this brief, and the pre-existing
`Subscription` schema placeholder (see `docs/feature-gap-analysis.md` §49) should stay exactly as inert as
it already was found.
