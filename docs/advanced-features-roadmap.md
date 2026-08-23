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

1. **Calls** (`Call`/`CallParticipant` schema exists, unused — `ContactsService.call` deliberately creates
   an instant meeting instead, documented as a scoping decision in Stage 11): build the real
   ring/accept/reject/busy/missed-call flow on top of it. This is the biggest genuinely-new real-time
   surface in this priority tier — needs a `WS_EVENTS.CALL_INCOMING`/`CALL_ACCEPTED`/`CALL_REJECTED`
   family (same gateway pattern as everything else here) plus incoming/outgoing call UI (a modal, not a
   full page) that, on accept, joins the same LiveKit room the meeting engine already uses — no second
   media engine, per the brief's own instruction.
2. ~~Contacts~~ — done, Stage 22. Block user (symmetric — either direction blocks both — checked at call
   initiation and DM creation; meeting invite has no targeted-invite endpoint to check in this codebase,
   noted honestly rather than invented), contact groups, favorites.
3. **Groups** as a first-class concept beyond Team Chat's flat `GROUP` rooms: group photo, group-level
   admins distinct from ChatMember, group meeting/call shortcuts. Whether this needs its own `Group` model
   or is better modeled as `ChatRoom` gaining `photoUrl`/an `admin` role on `ChatMember` is worth a design
   pass rather than assuming — the latter is much less new surface area.
4. **Personal chat parity gaps**: same rewrite as Priority 1's chat-panel work, since Team Chat reuses the
   same components — edit message, forward message, voice messages (record + upload as a `ChatAttachment`
   with a distinct type), typing indicator (`WS_EVENTS.CHAT_TYPING` constant already exists, unwired — same
   situation `WS_EVENTS.CHAT_REACTION` was in before this session), online status (needs Priority 5's
   presence system, or a simpler "last seen" derived from session activity as a v1).
5. **Calendar**: day/week/month views over existing scheduled meetings/classes (`GET /meetings?from=&to=`
   equivalent) is mostly a new frontend page against data that already exists. Google/Outlook integration
   is genuinely new: OAuth token storage + calendar API push/pull, scoped as architecture-and-stub first
   (a `CalendarProvider` interface, mirroring how Stage 8 avoided hardcoding one AI vendor) rather than a
   full two-way sync in the first pass.

## Priority 4 — AI meeting assistant, AI classroom assistant, live transcription, captions

- AI meeting assistant: **done** (Stage 8, two sessions ago).
- AI classroom assistant: see Priority 2 item 4 above.
- **Live transcription and captions are architecturally distinct from Stage 8**, not an extension of it —
  worth stating plainly since they sound adjacent. Stage 8 is a *batch* pipeline (recording file → ffmpeg →
  Whisper, after the meeting ends). Live captions need a *streaming* pipeline against audio while the
  meeting is happening: either (a) a LiveKit Agent (a server-side participant that subscribes to room audio
  tracks and runs streaming STT, publishing caption text back over data channels — LiveKit's documented
  pattern for exactly this), or (b) client-side `SpeechRecognition` per participant, self-reported to the
  room. (a) gives every participant consistent captions and server-side control (recordable, moderatable);
  (b) needs zero new backend infra but is Chrome-only-ish, per-participant-accuracy-dependent, and each
  client hears only what its own mic picks up (not a real substitute for a shared caption stream). (a) is
  the architecturally correct choice for a product aiming to be "competitive with Zoom/Meet/Teams", at the
  cost of being real new infrastructure (a LiveKit Agent worker process, a new `TRANSCRIPTION_PROVIDER`
  streaming variant of the interface Stage 8 already established). Multilingual support: design the caption
  text payload with a `language` field from the start (matches `MeetingTranscript.language` already) even
  before more than one language is actually offered.

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
