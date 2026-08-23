import { Logger } from "@nestjs/common";
import OpenAI from "openai";
import { createReadStream } from "fs";
import type { TranscriptionProvider, TranscriptionResult, TranscriptSegmentInput } from "./transcription-provider.interface";
import type { SummarizationProvider, MeetingSummaryResult, StudyMaterialResult } from "./summarization-provider.interface";

// Structured Outputs schema for chat.completions — see
// https://platform.openai.com/docs/guides/structured-outputs. `strict: true`
// requires every property to be listed in `required`; optional-in-spirit fields
// (like an action item's owner) are modeled as nullable instead of omittable.
const SUMMARY_JSON_SCHEMA = {
  name: "meeting_summary",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string", description: "A concise 2-4 sentence overview of the whole meeting." },
      keyPoints: { type: "array", items: { type: "string" } },
      actionItems: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: { type: "string" },
            owner: { type: ["string", "null"], description: "Speaker name if stated, otherwise null." },
          },
          required: ["text", "owner"],
        },
      },
      decisions: { type: "array", items: { type: "string" } },
      questions: { type: "array", items: { type: "string" }, description: "Open questions raised but not answered." },
      chapters: {
        type: "array",
        description: "2-8 topic segments spanning the meeting, in chronological order.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            startMs: { type: "integer", description: "Millisecond offset into the meeting where this topic starts." },
          },
          required: ["title", "startMs"],
        },
      },
    },
    required: ["summary", "keyPoints", "actionItems", "decisions", "questions", "chapters"],
  },
} as const;

const STUDY_MATERIAL_JSON_SCHEMA = {
  name: "classroom_study_material",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", description: "A short, student-facing title for this study material, e.g. the lecture topic." },
      lectureNotes: {
        type: "string",
        description: "Organized lecture notes covering the material, in markdown, using only content actually present in the transcript.",
      },
      studyGuide: {
        type: "string",
        description: "A concise study guide summarizing what a student should know/review, in markdown.",
      },
      flashcards: {
        type: "array",
        description: "5-15 term/definition or question/answer flashcards drawn from the transcript.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            front: { type: "string" },
            back: { type: "string" },
          },
          required: ["front", "back"],
        },
      },
      practiceQuestions: {
        type: "array",
        description: "3-10 multiple-choice practice questions with exactly one correct option each.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            options: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: { text: { type: "string" }, isCorrect: { type: "boolean" } },
                required: ["text", "isCorrect"],
              },
            },
          },
          required: ["question", "options"],
        },
      },
    },
    required: ["title", "lectureNotes", "studyGuide", "flashcards", "practiceQuestions"],
  },
} as const;

/**
 * OpenAI-backed implementation of both AI provider interfaces. Selected by
 * ../ai-provider.module.ts when TRANSCRIPTION_PROVIDER / AI_PROVIDER is
 * "openai" and OPENAI_API_KEY is set — see those env vars in
 * packages/config/src/env.ts.
 */
export class OpenAiTranscriptionProvider implements TranscriptionProvider {
  readonly name = "openai";
  private readonly logger = new Logger(OpenAiTranscriptionProvider.name);
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async transcribe(input: { filePath: string; language?: string }): Promise<TranscriptionResult> {
    // whisper-1 + verbose_json gives second-granularity segment timestamps without
    // needing the voice-activity-detection chunking config gpt-4o-transcribe-diarize
    // requires for inputs over 30s. Trade-off: no speaker diarization — see the
    // TranscriptSegmentInput.speakerLabel doc comment. Upgrading to
    // gpt-4o-transcribe-diarize + response_format: "diarized_json" for real
    // per-speaker labels is a natural follow-up once that model is broadly
    // available, without any interface change on this class's callers.
    const response = await this.client.audio.transcriptions.create({
      file: createReadStream(input.filePath),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
      language: input.language,
    });

    const segments: TranscriptSegmentInput[] = (response.segments ?? []).map((s) => ({
      startMs: Math.round(s.start * 1000),
      endMs: Math.round(s.end * 1000),
      text: s.text.trim(),
    }));

    if (segments.length === 0) {
      this.logger.warn(`whisper-1 returned no segments for ${input.filePath} (silent chunk or transcription failure)`);
    }

    return { language: response.language || input.language || "en", segments };
  }
}

export class OpenAiSummarizationProvider implements SummarizationProvider {
  readonly name = "openai";
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async summarize(input: {
    transcriptText: string;
    segments: { startMs: number; endMs: number; text: string; speakerLabel?: string }[];
  }): Promise<MeetingSummaryResult> {
    const completion = await this.client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You summarize meeting and online-class transcripts for a video conferencing product. Be concise " +
            "and strictly factual: only report action items, decisions, and questions that are actually " +
            "present in the transcript text — never invent content. Chapter startMs values must be real " +
            "millisecond timestamps copied from the transcript, spaced by topic change.",
        },
        { role: "user", content: input.transcriptText },
      ],
      response_format: { type: "json_schema", json_schema: SUMMARY_JSON_SCHEMA },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("OpenAI summarization returned no content");
    return JSON.parse(raw) as MeetingSummaryResult;
  }

  async generateStudyMaterial(input: {
    transcriptText: string;
    segments: { startMs: number; endMs: number; text: string; speakerLabel?: string }[];
  }): Promise<StudyMaterialResult> {
    const completion = await this.client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You turn an online-class transcript into study material for students. Be strictly factual — only " +
            "use content actually present in the transcript, never invent facts, dates, or terms that weren't " +
            "said. Lecture notes and the study guide should be organized and skimmable (markdown headings/lists). " +
            "Every flashcard and every practice question must be answerable from the transcript alone. Each " +
            "practice question needs exactly one option with isCorrect: true.",
        },
        { role: "user", content: input.transcriptText },
      ],
      response_format: { type: "json_schema", json_schema: STUDY_MATERIAL_JSON_SCHEMA },
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("OpenAI study material generation returned no content");
    return JSON.parse(raw) as StudyMaterialResult;
  }
}
