import { z } from "zod";

export const setFeatureFlagSchema = z.object({
  enabled: z.boolean(),
  description: z.string().max(500).optional(),
});
export type SetFeatureFlagDto = z.infer<typeof setFeatureFlagSchema>;
