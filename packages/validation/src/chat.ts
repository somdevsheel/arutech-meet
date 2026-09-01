import { z } from "zod";

/** Creates (or, for a DIRECT room between two specific people, reuses) a
 * standing chat room outside of any meeting — "Team Chat". GROUP rooms need a
 * name and at least one other member; DIRECT rooms are keyed by the pair of
 * users and named client-side, so `name` is ignored for them. */
export const createChatRoomSchema = z.object({
  type: z.enum(["GROUP", "DIRECT"]),
  name: z.string().min(1).max(100).optional(),
  memberUserIds: z.array(z.string().uuid()).min(1),
});
export type CreateChatRoomDto = z.infer<typeof createChatRoomSchema>;

export const sendRoomChatMessageSchema = z
  .object({
    // Optional (not min(1)) so a file/voice message can be sent on its own —
    // same allowance meeting chat's sendChatMessageSchema already has.
    body: z.string().max(4000).optional(),
    replyToId: z.string().uuid().optional(),
    fileId: z.string().uuid().optional(),
  })
  .refine((data) => (data.body && data.body.length > 0) || data.fileId, {
    message: "A message needs either text or an attached file",
  });
export type SendRoomChatMessageDto = z.infer<typeof sendRoomChatMessageSchema>;

export const editMessageSchema = z.object({
  body: z.string().min(1).max(4000),
});
export type EditMessageDto = z.infer<typeof editMessageSchema>;

export const forwardMessageSchema = z.object({
  messageId: z.string().uuid(),
});
export type ForwardMessageDto = z.infer<typeof forwardMessageSchema>;

/** GROUP rooms only — rename and/or set a photo. Same "just a URL" convention
 * as User.avatarUrl/Organization.logoUrl (see the schema comment on
 * ChatRoom.photoUrl). `.nullable()` matters here, not just `.optional()`:
 * omitting the field means "leave the photo as it is", but the only way to
 * ever remove a previously-set photo is to send an explicit `null` — see
 * organizations.ts's updateOrganizationSchema.logoUrl for the identical
 * convention this was missing. */
export const updateChatRoomSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  photoUrl: z.string().url().nullable().optional(),
});
export type UpdateChatRoomDto = z.infer<typeof updateChatRoomSchema>;

export const addChatRoomMemberSchema = z.object({
  userId: z.string().uuid(),
});
export type AddChatRoomMemberDto = z.infer<typeof addChatRoomMemberSchema>;
