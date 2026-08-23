import { z } from "zod";

// --- File uploads (chat/meeting attachments) --------------------------------

/** Server-enforced allowlist lives in FilesService (the real gate) — this cap
 * is just early client/schema-level rejection for an obviously-too-large
 * request before a presigned URL is even minted. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB

export const presignUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});
export type PresignUploadDto = z.infer<typeof presignUploadSchema>;
