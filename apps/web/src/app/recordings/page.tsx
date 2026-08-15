"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/layout/app-shell";

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

export default function RecordingsPage() {
  const router = useRouter();
  const { user, accessToken, clear, hasHydrated } = useAuthStore();
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    apiFetch<Recording[]>("/recordings")
      .then(setRecordings)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load recordings"));
  }, [hasHydrated, accessToken, router]);

  async function play(rec: Recording) {
    setOpeningId(rec.id);
    try {
      const { url } = await apiFetch<{ url: string }>(`/meetings/${rec.meetingId}/recordings/${rec.id}/download`);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to open recording");
    } finally {
      setOpeningId(null);
    }
  }

  if (!user) return null;

  return (
    <AppShell
      user={user}
      active="recordings"
      accessToken={accessToken}
      onSignOut={() => {
        clear();
        router.push("/");
      }}
    >
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recordings</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            Every recording that finished processing, across every meeting you were in.
          </p>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        {recordings === null && <p className="text-sm text-ink-muted">Loading…</p>}
        {recordings?.length === 0 && (
          <div className="rounded-lg border border-dashed border-surface-border px-4 py-10 text-center text-sm text-ink-muted">
            No recordings yet — start one from inside a meeting (Record in the toolbar).
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recordings?.map((rec) => (
            <button
              key={rec.id}
              onClick={() => play(rec)}
              disabled={openingId === rec.id}
              className="rounded-lg border border-surface-border bg-surface-raised text-left transition hover:-translate-y-0.5 hover:border-surface-border2 disabled:opacity-60"
            >
              <span className="relative flex aspect-[7/3] items-center justify-center bg-surface-field">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
                <span className="absolute bottom-2 right-2 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {formatDuration(rec.durationSeconds)}
                </span>
              </span>
              <span className="block p-3.5">
                <span className="block truncate text-[13px] font-semibold">{rec.meeting.title}</span>
                <span className="mt-1 block text-[10px] text-ink-muted">
                  {new Date(rec.startedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
