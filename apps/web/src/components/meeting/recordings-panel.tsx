"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { WS_EVENTS } from "@arutech/types";
import { apiFetch, ApiError } from "@/lib/api-client";

interface Recording {
  id: string;
  status: "PENDING" | "RECORDING" | "PROCESSING" | "READY" | "FAILED" | "DELETED";
  startedAt: string;
  durationSeconds: number | null;
  sizeBytes: string | null; // BigInt serializes as string over JSON
}

const STATUS_LABEL: Record<Recording["status"], string> = {
  PENDING: "Starting…",
  RECORDING: "● Recording",
  PROCESSING: "Processing…",
  READY: "Ready",
  FAILED: "Failed",
  DELETED: "Deleted",
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);

  async function refresh() {
    const data = await apiFetch<Recording[]>(`/meetings/${meetingId}/recordings`);
    setRecordings(data);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  useEffect(() => {
    if (!socket) return;
    const onChange = () => refresh();
    socket.on(WS_EVENTS.RECORDING_STARTED, onChange);
    socket.on(WS_EVENTS.RECORDING_STOPPED, onChange);
    // Covers the webhook-driven PROCESSING -> READY/FAILED transition, which
    // happens well after STOPPED fires and otherwise never reaches this panel
    // (previously required closing and reopening the tab to see it).
    socket.on(WS_EVENTS.RECORDING_UPDATED, onChange);
    return () => {
      socket.off(WS_EVENTS.RECORDING_STARTED, onChange);
      socket.off(WS_EVENTS.RECORDING_STOPPED, onChange);
      socket.off(WS_EVENTS.RECORDING_UPDATED, onChange);
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
    const { url } = await apiFetch<{ url: string }>(`/meetings/${meetingId}/recordings/${recordingId}/download`);
    setPlaybackUrl(url);
  }

  async function remove(recordingId: string) {
    await apiFetch(`/meetings/${meetingId}/recordings/${recordingId}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      {isModerator && (
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
      )}

      <div className="space-y-2">
        {recordings.length === 0 && <p className="text-xs text-ink-muted">No recordings for this meeting yet.</p>}
        {recordings.map((r) => (
          <div key={r.id} className="rounded-lg border border-surface-border p-3">
            <div className="flex items-center justify-between">
              <span
                className={`text-xs font-medium ${r.status === "RECORDING" ? "text-danger" : "text-ink-3"}`}
              >
                {STATUS_LABEL[r.status]}
              </span>
              <span className="text-[11px] text-ink-muted">{new Date(r.startedAt).toLocaleString()}</span>
            </div>
            {r.durationSeconds !== null && (
              <p className="mt-1 text-[11px] text-ink-muted">{Math.round(r.durationSeconds / 60)} min</p>
            )}
            {r.status === "READY" && (
              <div className="mt-2 flex gap-3 text-xs">
                <button onClick={() => play(r.id)} className="text-brand-300">
                  Play
                </button>
                {isModerator && (
                  <button onClick={() => remove(r.id)} className="text-danger">
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {playbackUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={() => setPlaybackUrl(null)}>
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
