import { z } from "zod";

export const REPORT_REASONS = ["HARASSMENT", "SPAM", "INAPPROPRIATE_CONTENT", "IMPERSONATION", "OTHER"] as const;

// Exactly one of reportedUserId/reportedGuestName — a report always names a
// real target, never neither (nothing to review) or both (ambiguous which
// one actually matters).
export const createReportSchema = z
  .object({
    reportedUserId: z.string().uuid().optional(),
    reportedGuestName: z.string().trim().min(1).max(100).optional(),
    reason: z.enum(REPORT_REASONS),
    details: z.string().trim().max(2000).optional(),
  })
  .refine((data) => Boolean(data.reportedUserId) !== Boolean(data.reportedGuestName), {
    message: "Provide exactly one of reportedUserId or reportedGuestName",
  });
export type CreateReportDto = z.infer<typeof createReportSchema>;

export const resolveReportSchema = z.object({
  status: z.enum(["RESOLVED", "DISMISSED"]),
  resolutionNote: z.string().trim().max(2000).optional(),
});
export type ResolveReportDto = z.infer<typeof resolveReportSchema>;
