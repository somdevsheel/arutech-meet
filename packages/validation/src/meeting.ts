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

export const updateMeetingSchema = createMeetingSchema.partial();
export type UpdateMeetingDto = z.infer<typeof updateMeetingSchema>;

export const joinMeetingSchema = z.object({
  password: z.string().max(64).optional(),
  guestName: z.string().min(1).max(100).optional(),
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
