import type { ParticipantRole } from "./roles";

/**
 * Centralized in-meeting/in-class capability model.
 *
 * This module is the SINGLE definition of "what can a given participant role do".
 * It is consumed by:
 *   - apps/api: PermissionService loads the participant's role from the database
 *     (never from client input) and calls `can()` before allowing any mutating
 *     action. This is the authoritative, enforced check.
 *   - apps/web / apps/mobile: the same `can()` function is used purely to decide
 *     what UI to render (e.g. hide the "remove participant" button). This is a
 *     convenience/UX layer only — the backend re-checks independently and a
 *     forged client request without the capability is always rejected server-side.
 *
 * Do not duplicate this matrix elsewhere. Add new capabilities here first.
 */
export const CAPABILITIES = [
  "meeting.end",
  "meeting.lock",
  "meeting.settings.update",
  "participant.mute",
  "participant.unmute_request.approve",
  "participant.camera.disable",
  "participant.remove",
  "participant.role.promote_co_host",
  "participant.role.demote",
  "waiting_room.admit",
  "waiting_room.deny",
  "screen_share.self",
  // Also gates approving/denying someone else's screen-share *request*
  // (ParticipantsService.approveScreenShare/denyScreenShare) — a request
  // only ever exists because the requester lacks `screen_share.self` in the
  // first place (see SCREEN_SHARE_REQUESTED's own doc comment in
  // websocket-events.ts), so whoever can already force-stop someone's
  // screen share is the same authority that should decide whether to let
  // one start. Not a separate capability — the two actions are close enough
  // in scope that adding one just for "approve a request" would be
  // duplicating this same role boundary for no real gain.
  "screen_share.others.stop",
  "chat.send",
  "chat.delete_any_message",
  "recording.start",
  "recording.stop",
  "recording.delete",
  "captions.manage",
  "whiteboard.edit",
  "poll.create",
  "poll.respond",
  "quiz.create",
  "quiz.answer",
  "breakout.manage",
  "attendance.view",
  "attendance.export",
  "transcript.generate",
  "transcript.delete",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const OWNER_HOST_CAPS: Capability[] = [
  "meeting.end",
  "meeting.lock",
  "meeting.settings.update",
  "participant.mute",
  "participant.unmute_request.approve",
  "participant.camera.disable",
  "participant.remove",
  "participant.role.promote_co_host",
  "participant.role.demote",
  "waiting_room.admit",
  "waiting_room.deny",
  "screen_share.self",
  "screen_share.others.stop",
  "chat.send",
  "chat.delete_any_message",
  "recording.start",
  "recording.stop",
  "recording.delete",
  "captions.manage",
  "whiteboard.edit",
  "poll.create",
  "poll.respond",
  "quiz.create",
  "quiz.answer",
  "breakout.manage",
  "attendance.view",
  "attendance.export",
  "transcript.generate",
  "transcript.delete",
];

const TEACHER_CAPS: Capability[] = OWNER_HOST_CAPS;

const CO_HOST_CAPS: Capability[] = [
  "participant.mute",
  "participant.unmute_request.approve",
  "participant.camera.disable",
  "participant.remove",
  "waiting_room.admit",
  "waiting_room.deny",
  "screen_share.self",
  "screen_share.others.stop",
  "chat.send",
  "chat.delete_any_message",
  "recording.start",
  "recording.stop",
  "captions.manage",
  "whiteboard.edit",
  "poll.create",
  "poll.respond",
  "quiz.create",
  "quiz.answer",
  "attendance.view",
  "transcript.generate",
];

const PARTICIPANT_STUDENT_CAPS: Capability[] = [
  "screen_share.self",
  "chat.send",
  "whiteboard.edit",
  "poll.respond",
  "quiz.answer",
];

// Everyone actually in the meeting — including a role that can only
// poll.create/quiz.create, or a GUEST who can only chat.send below — should
// be able to answer a poll or quiz someone else is running: `poll.respond`/
// `quiz.answer` is not "author-only" like `poll.create`/`quiz.create` is,
// it's "anyone present". Previously missing from OWNER_HOST_CAPS/CO_HOST_CAPS
// (above) and GUEST_CAPS (below) — an unintentional omission (nothing in
// permissions-matrix.spec.ts asserted the exclusion), not a deliberate
// design decision, so a host running their own poll, a promoted co-host,
// and guests all got a silent 403 on Submit with no client-side handling.
const GUEST_CAPS: Capability[] = ["chat.send", "poll.respond", "quiz.answer"];

/** Role → capability set. Screen share for PARTICIPANT/STUDENT is granted only when
 * the meeting's `screenShareScope` setting is `ALL_PARTICIPANTS` — that check is
 * layered on top of this matrix by the caller (see apps/api PermissionService). */
export const ROLE_CAPABILITIES: Record<ParticipantRole, Capability[]> = {
  OWNER: OWNER_HOST_CAPS,
  HOST: OWNER_HOST_CAPS,
  CO_HOST: CO_HOST_CAPS,
  TEACHER: TEACHER_CAPS,
  STUDENT: PARTICIPANT_STUDENT_CAPS,
  PARTICIPANT: PARTICIPANT_STUDENT_CAPS,
  GUEST: GUEST_CAPS,
};

export function can(role: ParticipantRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

export function assertCan(role: ParticipantRole, capability: Capability): void {
  if (!can(role, capability)) {
    throw new Error(`Role ${role} lacks capability ${capability}`);
  }
}
