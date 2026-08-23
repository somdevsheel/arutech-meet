import { Module } from "@nestjs/common";
import type { Env } from "@arutech/config";
import { TRANSCRIPTION_PROVIDER } from "./providers/transcription-provider.interface";
import { SUMMARIZATION_PROVIDER } from "./providers/summarization-provider.interface";
import { OpenAiTranscriptionProvider, OpenAiSummarizationProvider } from "./providers/openai-ai.provider";
import { NullTranscriptionProvider, NullSummarizationProvider } from "./providers/null-ai.provider";

/**
 * Resolves the pluggable AI backends TranscriptsService depends on, purely from
 * env vars (`TRANSCRIPTION_PROVIDER`, `AI_PROVIDER` — see packages/config/src/env.ts),
 * each selected independently so e.g. OpenAI Whisper for speech-to-text can pair
 * with a different vendor's LLM for summarization, or either can be swapped for
 * a self-hosted model later.
 *
 * To add a new vendor: implement TranscriptionProvider and/or SummarizationProvider
 * (see ./providers), add a case below. TranscriptsService only ever depends on the
 * interfaces (injected via the TRANSCRIPTION_PROVIDER / SUMMARIZATION_PROVIDER
 * tokens), never a concrete class — this is the seam the platform brief asks for
 * ("do not hardcode the entire application around one AI provider").
 */
@Module({
  providers: [
    {
      provide: TRANSCRIPTION_PROVIDER,
      inject: ["ENV"],
      useFactory: (env: Env) => {
        if (env.TRANSCRIPTION_PROVIDER === "openai" && env.OPENAI_API_KEY) {
          return new OpenAiTranscriptionProvider(env.OPENAI_API_KEY);
        }
        return new NullTranscriptionProvider();
      },
    },
    {
      provide: SUMMARIZATION_PROVIDER,
      inject: ["ENV"],
      useFactory: (env: Env) => {
        if (env.AI_PROVIDER === "openai" && env.OPENAI_API_KEY) {
          return new OpenAiSummarizationProvider(env.OPENAI_API_KEY);
        }
        return new NullSummarizationProvider();
      },
    },
  ],
  exports: [TRANSCRIPTION_PROVIDER, SUMMARIZATION_PROVIDER],
})
export class AiProviderModule {}
