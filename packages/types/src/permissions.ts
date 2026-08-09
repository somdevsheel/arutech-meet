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
  "screen_share.others.stop",
  "chat.send",
  "chat.delete_any_message",
  "recording.start",
  "recording.stop",
  "recording.delete",
  "whiteboard.edit",
  "poll.create",
  "poll.respond",
  "quiz.create",
  "quiz.answer",
  "breakout.manage",
  "attendance.view",
  "attendance.export",
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
  "whiteboard.edit",
  "poll.create",
  "quiz.create",
  "breakout.manage",
  "attendance.view",
  "attendance.export",
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
  "whiteboard.edit",
  "poll.create",
  "quiz.create",
  "attendance.view",
];

const PARTICIPANT_STUDENT_CAPS: Capability[] = [
  "screen_share.self",
  "chat.send",
  "whiteboard.edit",
  "poll.respond",
  "quiz.answer",
];

const GUEST_CAPS: Capability[] = ["chat.send"];

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
