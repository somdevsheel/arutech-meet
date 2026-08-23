import { z } from "zod";

// --- Personal calls (1:1/group, outside any meeting) ------------------------

export const initiateCallSchema = z.object({
  calleeUserIds: z.array(z.string().uuid()).min(1).max(8),
  type: z.enum(["AUDIO", "VIDEO"]),
});
export type InitiateCallDto = z.infer<typeof initiateCallSchema>;
