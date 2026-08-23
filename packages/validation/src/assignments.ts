import { z } from "zod";

// --- Classroom assignments ---------------------------------------------------

export const createAssignmentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  dueAt: z.string().datetime().optional(),
  fileId: z.string().uuid().optional(),
});
export type CreateAssignmentDto = z.infer<typeof createAssignmentSchema>;

export const updateAssignmentSchema = createAssignmentSchema.partial();
export type UpdateAssignmentDto = z.infer<typeof updateAssignmentSchema>;

export const submitAssignmentSchema = z
  .object({
    textContent: z.string().max(20000).optional(),
    fileId: z.string().uuid().optional(),
  })
  .refine((data) => (data.textContent && data.textContent.length > 0) || data.fileId, {
    message: "A submission needs either text or an attached file",
  });
export type SubmitAssignmentDto = z.infer<typeof submitAssignmentSchema>;

export const gradeSubmissionSchema = z.object({
  score: z.number().int().min(0).max(1000),
  feedback: z.string().max(4000).optional(),
});
export type GradeSubmissionDto = z.infer<typeof gradeSubmissionSchema>;
