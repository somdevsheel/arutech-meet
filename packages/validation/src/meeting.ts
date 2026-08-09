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

export const sendChatMessageSchema = z.object({
  body: z.string().min(1).max(4000),
  replyToId: z.string().uuid().optional(),
  isPrivate: z.boolean().default(false),
  toUserId: z.string().uuid().optional(),
});
export type SendChatMessageDto = z.infer<typeof sendChatMessageSchema>;
