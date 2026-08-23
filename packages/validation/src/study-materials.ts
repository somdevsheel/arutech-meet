import { z } from "zod";

// AI classroom assistant — generates lecture notes/flashcards/practice
// questions/study guide from a class session's already-existing (READY)
// transcript. Ships DRAFT; a teacher must explicitly publish before students
// can see it (packages/database's ClassroomStudyMaterial schema comment).

export const generateStudyMaterialSchema = z.object({
  transcriptId: z.string().uuid(),
});
export type GenerateStudyMaterialDto = z.infer<typeof generateStudyMaterialSchema>;
