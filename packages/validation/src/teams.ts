import { z } from "zod";

export const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});
export type CreateTeamDto = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = createTeamSchema.partial();
export type UpdateTeamDto = z.infer<typeof updateTeamSchema>;

export const updateTeamMemberRoleSchema = z.object({
  role: z.enum(["LEAD", "MEMBER"]),
});
export type UpdateTeamMemberRoleDto = z.infer<typeof updateTeamMemberRoleSchema>;
