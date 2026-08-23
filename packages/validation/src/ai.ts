import { z } from "zod";

// --- AI meeting assistant ---------------------------------------------------

export const generateTranscriptSchema = z.object({
  /** Explicit recording to transcribe. Omit to use the meeting's most recent
   * READY recording — see TranscriptsService.generate. */
  recordingId: z.string().uuid().optional(),
});
export type GenerateTranscriptDto = z.infer<typeof generateTranscriptSchema>;
