export interface ActionItem {
  text: string;
  owner?: string | null;
}

export interface Chapter {
  title: string;
  startMs: number;
}

export interface MeetingSummaryResult {
  summary: string;
  keyPoints: string[];
  actionItems: ActionItem[];
  decisions: string[];
  questions: string[];
  chapters: Chapter[];
}

export interface StudyMaterialFlashcard {
  front: string;
  back: string;
}

export interface StudyMaterialQuestionOption {
  text: string;
  isCorrect: boolean;
}

export interface StudyMaterialPracticeQuestion {
  question: string;
  options: StudyMaterialQuestionOption[];
}

/** AI classroom assistant output — see docs/roadmap.md's Stage 21 write-up
 * for why this is a second method on the same interface rather than a
 * separate provider abstraction (same LLM backend, same selection-by-env-var,
 * just a different prompt + JSON schema from `summarize`). */
export interface StudyMaterialResult {
  title: string;
  lectureNotes: string;
  studyGuide: string;
  flashcards: StudyMaterialFlashcard[];
  practiceQuestions: StudyMaterialPracticeQuestion[];
}

/**
 * LLM backend that turns a transcript into structured content. Selected by
 * the `AI_PROVIDER` env var (see ../ai-provider.module.ts), independently of
 * `TranscriptionProvider` — you can pair OpenAI Whisper for speech-to-text with
 * a different vendor's LLM here, or vice versa. To add a new vendor, implement
 * this interface and add a case to that factory; `TranscriptsService`/
 * `StudyMaterialsService` never import a concrete provider directly.
 */
export interface SummarizationProvider {
  readonly name: string;
  summarize(input: {
    transcriptText: string;
    segments: { startMs: number; endMs: number; text: string; speakerLabel?: string }[];
  }): Promise<MeetingSummaryResult>;
  generateStudyMaterial(input: {
    transcriptText: string;
    segments: { startMs: number; endMs: number; text: string; speakerLabel?: string }[];
  }): Promise<StudyMaterialResult>;
}

export const SUMMARIZATION_PROVIDER = Symbol("SUMMARIZATION_PROVIDER");
