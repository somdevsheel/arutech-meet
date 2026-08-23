import { z } from "zod";

// A Course groups however many Class "batches" are actually taught under it —
// see the schema comment on `Course` in packages/database for why this is a
// separate, optional layer rather than a replacement for `Class`.

export const createCourseSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  orgId: z.string().uuid().optional(),
});
export type CreateCourseDto = z.infer<typeof createCourseSchema>;

export const updateCourseSchema = createCourseSchema.partial();
export type UpdateCourseDto = z.infer<typeof updateCourseSchema>;
