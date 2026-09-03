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

// Adds someone by their existing account id, not email — unlike a meeting or
// an org, anyone addable here is already a real org member (teams are a
// sub-group of one), so there's no "invite someone with no account yet"
// case to handle; the org's own invite flow is what gets a person that far.
export const addTeamMemberSchema = z.object({
  userId: z.string().uuid(),
});
export type AddTeamMemberDto = z.infer<typeof addTeamMemberSchema>;
