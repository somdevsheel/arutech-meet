export interface TranscriptSegmentInput {
  /** Undefined when the provider doesn't support speaker diarization (e.g. OpenAI's
   * whisper-1 API doesn't) — TranscriptsService is honest about this in the UI rather
   * than fabricating speaker names. */
  speakerLabel?: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptionResult {
  language: string;
  segments: TranscriptSegmentInput[];
}

/**
 * Speech-to-text backend. Implementations turn one audio file on disk into a
 * timestamped transcript. Selected by the `TRANSCRIPTION_PROVIDER` env var (see
 * ../ai-provider.module.ts) — to plug in a different vendor or a self-hosted
 * model (e.g. faster-whisper behind an HTTP endpoint), implement this interface
 * and add a case to that factory. `TranscriptsService` never imports a concrete
 * provider directly.
 */
export interface TranscriptionProvider {
  readonly name: string;
  transcribe(input: { filePath: string; language?: string }): Promise<TranscriptionResult>;
}

export const TRANSCRIPTION_PROVIDER = Symbol("TRANSCRIPTION_PROVIDER");
