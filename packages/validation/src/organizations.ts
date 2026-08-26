import { z } from "zod";

export const createOrganizationSchema = z.object({ name: z.string().min(1).max(100) });
export type CreateOrganizationDto = z.infer<typeof createOrganizationSchema>;

export const addOrgMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});
export type AddOrgMemberDto = z.infer<typeof addOrgMemberSchema>;

export const inviteOrgMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});
export type InviteOrgMemberDto = z.infer<typeof inviteOrgMemberSchema>;

export const updateOrgMemberRoleSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
});
export type UpdateOrgMemberRoleDto = z.infer<typeof updateOrgMemberRoleSchema>;

// Every field nullable-and-optional: `null` clears it back to unbranded,
// `undefined`/omitted leaves it as-is, a real value sets it — a plain PATCH,
// not a full-replace PUT.
export const updateOrgBrandingSchema = z.object({
  logoUrl: z.string().url().max(2048).nullable().optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "brandColor must be a 6-digit hex color, e.g. #3B6FE0")
    .nullable()
    .optional(),
  joinPageMessage: z.string().trim().max(280).nullable().optional(),
});
export type UpdateOrgBrandingDto = z.infer<typeof updateOrgBrandingSchema>;
