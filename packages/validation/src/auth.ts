import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[0-9]/, "Password must contain a number");

export const usernameSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-zA-Z0-9_]+$/, "Username may only contain letters, numbers, and underscores");

export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: passwordSchema,
  displayName: z.string().min(1).max(100),
  username: usernameSchema,
  timezone: z.string().max(64).optional(),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshDto = z.infer<typeof refreshSchema>;

export const requestPasswordResetSchema = z.object({
  email: z.string().email().max(255),
});
export type RequestPasswordResetDto = z.infer<typeof requestPasswordResetSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailDto = z.infer<typeof verifyEmailSchema>;
