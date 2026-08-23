import { z } from "zod";

export const blockUserSchema = z.object({
  userId: z.string().uuid(),
});
export type BlockUserDto = z.infer<typeof blockUserSchema>;

export const createContactGroupSchema = z.object({
  name: z.string().min(1).max(100),
});
export type CreateContactGroupDto = z.infer<typeof createContactGroupSchema>;

export const addToContactGroupSchema = z.object({
  userId: z.string().uuid(),
});
export type AddToContactGroupDto = z.infer<typeof addToContactGroupSchema>;
