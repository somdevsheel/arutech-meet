import { z } from "zod";

export const meetingSettingsSchema = z.object({
  waitingRoomEnabled: z.boolean().default(true),
  allowJoinBeforeHost: z.boolean().default(false),
  muteOnEntry: z.boolean().default(true),
  screenShareScope: z.enum(["HOST_ONLY", "ALL_PARTICIPANTS"]).default("HOST_ONLY"),
  allowChat: z.boolean().default(true),
  allowRecording: z.boolean().default(true),
  allowParticipantsUnmuteSelf: z.boolean().default(true),
  lockAfterStart: z.boolean().default(false),
  maxParticipants: z.number().int().min(2).max(1000).default(100),
  // Bare lowercase domains ("acme.com"), no leading "@". Empty = no
  // restriction. Checked at join time against the joiner's own account
  // email — see MeetingsService.join.
  allowedEmailDomains: z
    .array(z.string().trim().toLowerCase().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Enter a bare domain, e.g. acme.com"))
    .max(20)
    .default([]),
});
export type MeetingSettingsDto = z.infer<typeof meetingSettingsSchema>;

export const createMeetingSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(["INSTANT", "SCHEDULED", "RECURRING"]).default("INSTANT"),
  password: z.string().min(4).max(64).optional(),
  scheduledStart: z.string().datetime().optional(),
  scheduledEnd: z.string().datetime().optional(),
  timezone: z.string().max(64).default("UTC"),
  recurrenceFrequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional(),
  recurrenceUntil: z.string().datetime().optional(),
  orgId: z.string().uuid().optional(),
  settings: meetingSettingsSchema.partial().optional(),
});
export type CreateMeetingDto = z.infer<typeof createMeetingSchema>;

export const updateMeetingSchema = createMeetingSchema.partial().extend({
  // Wider than create's `password` (a string or omitted entirely): an
  // update also needs to say "remove the current password" — a state
  // create-time never has to represent, since there's no existing password
  // yet to remove. Explicit `null` means clear it; omitted means leave
  // whatever's already set as-is; a string sets/replaces it. See
  // MeetingsService.updateSettings for how each of the three is handled.
  password: z.string().min(4).max(64).nullable().optional(),
});
export type UpdateMeetingDto = z.infer<typeof updateMeetingSchema>;

export const joinMeetingSchema = z.object({
  password: z.string().max(64).optional(),
  guestName: z.string().min(1).max(100).optional(),
  // A guest reconnecting (a page reload, a flaky network) sends back the
  // MeetingParticipant.id their browser remembers from a prior join-as-guest
  // call in this same meeting (see sessionStorage use in the web app's join
  // page), so the server can recognize them as the SAME guest instead of
  // always creating a fresh row — the only way a denied/removed guest can
  // ever actually be told so on rejoin, the same protection an authenticated
  // user's account identity already gives them for free. Ignored (and
  // harmless) for the authenticated /join endpoint, which never reads it.
  guestParticipantId: z.string().uuid().optional(),
});
export type JoinMeetingDto = z.infer<typeof joinMeetingSchema>;

export const meetingParticipantModerationSchema = z.object({
  participantId: z.string().uuid(),
});
export type MeetingParticipantModerationDto = z.infer<typeof meetingParticipantModerationSchema>;

export const promoteCoHostSchema = z.object({
  participantId: z.string().uuid(),
});
export type PromoteCoHostDto = z.infer<typeof promoteCoHostSchema>;

// Deliberately just CO_HOST/PARTICIPANT, not the full ParticipantRole enum —
// OWNER/HOST aren't something an invite hands out, GUEST is what someone
// with no account joining unauthenticated already gets automatically, and
// TEACHER/STUDENT are class-session-derived (see MeetingsService.join),
// never chosen at invite time.
export const inviteMeetingParticipantSchema = z.object({
  email: z.string().email(),
  role: z.enum(["CO_HOST", "PARTICIPANT"]).default("PARTICIPANT"),
});
export type InviteMeetingParticipantDto = z.infer<typeof inviteMeetingParticipantSchema>;

export const sendChatMessageSchema = z
  .object({
    // Optional (not the min(1) it used to be) so a file/image can be sent on
    // its own, with no caption — same as every mainstream chat app.
    body: z.string().max(4000).optional(),
    replyToId: z.string().uuid().optional(),
    isPrivate: z.boolean().default(false),
    toUserId: z.string().uuid().optional(),
    fileId: z.string().uuid().optional(),
  })
  .refine((data) => (data.body && data.body.length > 0) || data.fileId, {
    message: "A message needs either text or an attached file",
  });
export type SendChatMessageDto = z.infer<typeof sendChatMessageSchema>;
