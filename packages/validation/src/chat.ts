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

export const sendRoomChatMessageSchema = z.object({
  body: z.string().min(1).max(4000),
  replyToId: z.string().uuid().optional(),
});
export type SendRoomChatMessageDto = z.infer<typeof sendRoomChatMessageSchema>;
