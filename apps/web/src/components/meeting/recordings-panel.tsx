"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { WS_EVENTS } from "@arutech/types";
import { apiFetch, ApiError } from "@/lib/api-client";
import { LocalRecordingControl } from "./local-recording-control";

interface Recording {
  id: string;
  status: "PENDING" | "RECORDING" | "PROCESSING" | "READY" | "FAILED" | "DELETED";
  startedAt: string;
  durationSeconds: number | null;
  sizeBytes: string | null; // BigInt serializes as string over JSON
}

interface AiSummary {
  summary: string;
  keyPoints: string[];
  actionItems: { text: string; owner?: string | null }[];
  decisions: string[];
  questions: string[];
  chapters: { title: string; startMs: number }[];
}

interface Transcript {
  id: string;
  recordingId: string | null;
  status: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  summary: AiSummary | null;
}

const STATUS_LABEL: Record<Recording["status"], string> = {
  PENDING: "Starting…",
  RECORDING: "● Recording",
  PROCESSING: "Processing…",
  READY: "Ready",
  FAILED: "Failed",
  DELETED: "Deleted",
};

const TRANSCRIPT_STATUS_LABEL: Record<Transcript["status"], string> = {
  PENDING: "Queued…",
  PROCESSING: "Transcribing…",
  READY: "Ready",
  FAILED: "Failed — try again",
};

export function RecordingsPanel({
  meetingId,
  socket,
  isModerator,
}: {
  meetingId: string;
  socket: Socket | null;
  isModerator: boolean;
}) {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [expandedRecordingId, setExpandedRecordingId] = useState<string | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  async function refresh() {
    const data = await apiFetch<Recording[]>(`/meetings/${meetingId}/recordings`);
    setRecordings(data);
  }

  async function refreshTranscripts() {
    const data = await apiFetch<Transcript[]>(`/meetings/${meetingId}/transcripts`);
    setTranscripts(data);
  }

  useEffect(() => {
    refresh();
    refreshTranscripts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  useEffect(() => {
    if (!socket) return;
    const onChange = () => refresh();
    const onTranscriptChange = () => refreshTranscripts();
    socket.on(WS_EVENTS.RECORDING_STARTED, onChange);
    socket.on(WS_EVENTS.RECORDING_STOPPED, onChange);
    // Covers the webhook-driven PROCESSING -> READY/FAILED transition, which
    // happens well after STOPPED fires and otherwise never reaches this panel
    // (previously required closing and reopening the tab to see it).
    socket.on(WS_EVENTS.RECORDING_UPDATED, onChange);
    socket.on(WS_EVENTS.TRANSCRIPT_UPDATED, onTranscriptChange);
    return () => {
      socket.off(WS_EVENTS.RECORDING_STARTED, onChange);
      socket.off(WS_EVENTS.RECORDING_STOPPED, onChange);
      socket.off(WS_EVENTS.RECORDING_UPDATED, onChange);
      socket.off(WS_EVENTS.TRANSCRIPT_UPDATED, onTranscriptChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, meetingId]);

  const active = recordings.find((r) => r.status === "RECORDING" || r.status === "PENDING");

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/meetings/${meetingId}/recordings/start`, { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start recording");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!active) return;
    setBusy(true);
    try {
      await apiFetch(`/meetings/${meetingId}/recordings/${active.id}/stop`, { method: "POST" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function play(recordingId: string) {
    const { url } = await apiFetch<{ url: string }>(
      `/meetings/${meetingId}/recordings/${recordingId}/download`,
    );
    setPlaybackUrl(url);
  }

  async function remove(recordingId: string) {
    await apiFetch(`/meetings/${meetingId}/recordings/${recordingId}`, { method: "DELETE" });
    await refresh();
  }

  async function generateTranscript(recordingId: string) {
    setTranscriptError(null);
    try {
      await apiFetch(`/meetings/${meetingId}/transcripts`, {
        method: "POST",
        body: JSON.stringify({ recordingId }),
      });
      await refreshTranscripts();
    } catch (err) {
      setTranscriptError(err instanceof ApiError ? err.message : "Failed to start transcription");
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      {isModerator && (
        <div>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            Meeting recording (saved to the library)
          </h3>
          <div className="rounded-lg border border-surface-border bg-surface-raised p-3">
            {active ? (
              <button
                onClick={stop}
                disabled={busy}
                className="w-full rounded bg-danger-strong py-2 text-xs font-medium text-white disabled:opacity-50"
              >
                Stop recording
              </button>
            ) : (
              <button
                onClick={start}
                disabled={busy}
                className="w-full rounded bg-brand-500 py-2 text-xs font-medium text-white disabled:opacity-50"
              >
                Start recording
              </button>
            )}
            {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          Local recording (this device only)
        </h3>
        <LocalRecordingControl />
      </div>

      <div className="space-y-2">
        {recordings.length === 0 && (
          <p className="text-xs text-ink-muted">No recordings for this meeting yet.</p>
        )}
        {recordings.map((r) => {
          const transcript = transcripts.find((t) => t.recordingId === r.id);
          const expanded = expandedRecordingId === r.id;
          return (
            <div key={r.id} className="rounded-lg border border-surface-border p-3">
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-medium ${r.status === "RECORDING" ? "text-danger" : "text-ink-3"}`}
                >
                  {STATUS_LABEL[r.status]}
                </span>
                <span className="text-[11px] text-ink-muted">
                  {new Date(r.startedAt).toLocaleString()}
                </span>
              </div>
              {r.durationSeconds !== null && (
                <p className="mt-1 text-[11px] text-ink-muted">
                  {Math.round(r.durationSeconds / 60)} min
                </p>
              )}
              {r.status === "READY" && (
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  <button onClick={() => play(r.id)} className="text-brand-300">
                    Play
                  </button>
                  {isModerator && (
                    <button onClick={() => remove(r.id)} className="text-danger">
                      Delete
                    </button>
                  )}
                  {!transcript && isModerator && (
                    <button onClick={() => generateTranscript(r.id)} className="text-brand-300">
                      Generate transcript &amp; AI summary
                    </button>
                  )}
                  {transcript && (
                    <button
                      onClick={() => setExpandedRecordingId(expanded ? null : r.id)}
                      className="text-brand-300"
                    >
                      {transcript.status === "READY"
                        ? expanded
                          ? "Hide transcript"
                          : "View transcript & AI summary"
                        : TRANSCRIPT_STATUS_LABEL[transcript.status]}
                    </button>
                  )}
                </div>
              )}

              {transcriptError && <p className="mt-2 text-xs text-danger">{transcriptError}</p>}

              {expanded && transcript?.status === "READY" && transcript.summary && (
                <div className="mt-3 space-y-2 rounded-md bg-surface-raised p-3 text-xs">
                  <div>
                    <p className="font-medium text-ink-2">Summary</p>
                    <p className="mt-1 text-ink-3">{transcript.summary.summary}</p>
                  </div>
                  {transcript.summary.keyPoints.length > 0 && (
                    <SummaryList title="Key points" items={transcript.summary.keyPoints} />
                  )}
                  {transcript.summary.decisions.length > 0 && (
                    <SummaryList title="Decisions" items={transcript.summary.decisions} />
                  )}
                  {transcript.summary.actionItems.length > 0 && (
                    <div>
                      <p className="font-medium text-ink-2">Action items</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-3">
                        {transcript.summary.actionItems.map((item, i) => (
                          <li key={i}>
                            {item.text}
                            {item.owner ? (
                              <span className="text-ink-muted"> — {item.owner}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {transcript.summary.questions.length > 0 && (
                    <SummaryList title="Open questions" items={transcript.summary.questions} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {playbackUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPlaybackUrl(null)}
        >
          <video
            src={playbackUrl}
            controls
            autoPlay
            className="max-h-full max-w-full rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="font-medium text-ink-2">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-3">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
