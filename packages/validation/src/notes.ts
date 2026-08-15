import { z } from "zod";

export const createNoteSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(50_000).default(""),
  meetingId: z.string().uuid().optional(),
});
export type CreateNoteDto = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = createNoteSchema.partial();
export type UpdateNoteDto = z.infer<typeof updateNoteSchema>;
