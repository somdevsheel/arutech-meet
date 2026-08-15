"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface Recording {
  id: string;
  meetingId: string;
  status: string;
  durationSeconds: number | null;
  startedAt: string;
  meeting: { title: string; code: string };
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Backed by the real GET /recordings endpoint (cross-meeting, READY only) —
 * not a static thumbnail gallery. Clicking a card fetches a genuine short-lived
 * presigned S3/MinIO playback URL and opens it, same download path the
 * in-meeting Recordings panel uses. */
export function RecordingsRow() {
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Recording[]>("/recordings")
      .then(setRecordings)
      .catch(() => setRecordings([]));
  }, []);

  async function play(rec: Recording) {
    setOpening(rec.id);
    try {
      const { url } = await apiFetch<{ url: string }>(
        `/meetings/${rec.meetingId}/recordings/${rec.id}/download`,
      );
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // link may have gone stale (deleted/expired) between listing and click
    } finally {
      setOpening(null);
    }
  }

  if (recordings !== null && recordings.length === 0) return null;

  return (
    <section>
      <div className="mb-3.5 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Recent recordings</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {recordings === null &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-lg border border-surface-border bg-surface-raised">
              <div className="aspect-[7/3] bg-surface-field" />
              <div className="space-y-2 p-3.5">
                <div className="h-3 w-2/3 rounded bg-surface-field" />
                <div className="h-2.5 w-1/3 rounded bg-surface-field" />
              </div>
            </div>
          ))}
        {recordings?.map((rec) => (
          <button
            key={rec.id}
            onClick={() => play(rec)}
            disabled={opening === rec.id}
            className="rounded-lg border border-surface-border bg-surface-raised text-left transition hover:-translate-y-0.5 hover:border-surface-border2 disabled:opacity-60"
          >
            <span className="relative flex aspect-[7/3] items-center justify-center bg-surface-field">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white">
                {opening === rec.id ? (
                  <Spinner />
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </span>
              <span className="absolute bottom-2 right-2 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {formatDuration(rec.durationSeconds)}
              </span>
            </span>
            <span className="block p-3.5">
              <span className="block truncate text-[13px] font-semibold">{rec.meeting.title}</span>
              <span className="mt-1 block text-[10px] text-ink-muted">
                {new Date(rec.startedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
