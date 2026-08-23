import { ServiceUnavailableException } from "@nestjs/common";
import type { TranscriptionProvider, TranscriptionResult } from "./transcription-provider.interface";
import type { SummarizationProvider, MeetingSummaryResult, StudyMaterialResult } from "./summarization-provider.interface";

/**
 * Selected when no real backend is configured (no `OPENAI_API_KEY`, or an
 * unrecognized `TRANSCRIPTION_PROVIDER`/`AI_PROVIDER` value — see
 * ../ai-provider.module.ts). Fails loudly and explicitly rather than returning a
 * fake transcript/summary, per this project's "no fake implementations" rule
 * (docs/roadmap.md) — TranscriptsService surfaces this as a normal 503 to the
 * caller, not a silently-empty result.
 */
export class NullTranscriptionProvider implements TranscriptionProvider {
  readonly name = "none";

  async transcribe(): Promise<TranscriptionResult> {
    throw new ServiceUnavailableException(
      "Transcription is not configured on this server. Set OPENAI_API_KEY (or point TRANSCRIPTION_PROVIDER " +
        "at a configured provider) to enable the AI meeting assistant.",
    );
  }
}

export class NullSummarizationProvider implements SummarizationProvider {
  readonly name = "none";

  async summarize(): Promise<MeetingSummaryResult> {
    throw new ServiceUnavailableException(
      "AI summarization is not configured on this server. Set OPENAI_API_KEY (or point AI_PROVIDER at a " +
        "configured provider) to enable the AI meeting assistant.",
    );
  }

  async generateStudyMaterial(): Promise<StudyMaterialResult> {
    throw new ServiceUnavailableException(
      "AI summarization is not configured on this server. Set OPENAI_API_KEY (or point AI_PROVIDER at a " +
        "configured provider) to enable the AI classroom assistant.",
    );
  }
}
