/** Shared between TranscriptsService (meeting summary) and StudyMaterialsService
 * (classroom assistant) — both feed an LLM the same `[mm:ss] Speaker: text` line
 * format built from a transcript's segments, just with a different prompt/schema
 * on the other end. */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatTranscriptText(
  segments: { startMs: number; text: string; speakerLabel?: string | null }[],
): string {
  return segments
    .map((s) => `[${formatTimestamp(s.startMs)}]${s.speakerLabel ? ` ${s.speakerLabel}:` : ""} ${s.text}`)
    .join("\n");
}
