"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch, apiFetchBlob, ApiError } from "@/lib/api-client";
import { env } from "@/lib/env";
import { useAuthStore } from "@/lib/auth-store";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { FullPageLoading } from "@/components/full-page-loading";

interface AttendanceRow {
  userId: string;
  user: { displayName: string };
  joinedAt: string | null;
  leftAt: string | null;
  durationSeconds: number;
  rejoinCount: number;
  status: "PRESENT" | "PARTIAL" | "ABSENT";
}

const STATUS_COLOR: Record<string, string> = {
  PRESENT: "text-success",
  PARTIAL: "text-warn",
  ABSENT: "text-danger",
};

export default function AttendancePage() {
  const params = useParams<{ id: string; sessionId: string }>();
  const router = useRouter();
  const { user, accessToken, clear } = useAuthStore();
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  // M-4: the initial load and Recompute both used to have no error handling
  // at all — a non-member's 403 (or a teacher-only Recompute from a
  // non-teacher member) just rejected silently, leaving the page showing an
  // empty table with "No attendance data yet — click Recompute", which both
  // hides the real reason and suggests a fix (Recompute) that would fail
  // the exact same way. Export CSV already handled this correctly (see
  // downloadCsv below) — these two now follow the same pattern.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeError, setRecomputeError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function refresh() {
    try {
      const data = await apiFetch<AttendanceRow[]>(`/class-sessions/${params.sessionId}/attendance`);
      setRows(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't load attendance");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.sessionId]);

  async function downloadCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await apiFetchBlob(`/class-sessions/${params.sessionId}/attendance/export.csv`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "attendance.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      // apiFetchBlob throws the same ApiError apiFetch does on a non-ok
      // response — this is the actual fix: a 401/403/etc. response used to
      // get silently saved to disk as "attendance.csv" (its JSON error body
      // is, after all, still valid bytes for a Blob) with no indication
      // anything had gone wrong. Show the real error instead of downloading it.
      setExportError(err instanceof ApiError ? err.message : "Couldn't export attendance");
    } finally {
      setExporting(false);
    }
  }

  async function recompute() {
    setRecomputing(true);
    setRecomputeError(null);
    try {
      await apiFetch(`/class-sessions/${params.sessionId}/attendance/recompute`, {
        method: "POST",
      });
      await refresh();
    } catch (err) {
      setRecomputeError(err instanceof ApiError ? err.message : "Couldn't recompute attendance");
    } finally {
      setRecomputing(false);
    }
  }

  if (!user) return <FullPageLoading />;

  return (
    <AppShell
      user={user}
      active="classes"
      accessToken={accessToken}
      onSignOut={() => {
        clear();
        router.push("/");
      }}
    >
      <div className="flex flex-col gap-6">
        <div>
          <Link href={`/classes/${params.id}`} className="text-sm text-ink-muted hover:text-white">
            ← Class
          </Link>
          <div className="mt-2 flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
            <div className="flex gap-3">
              <button
                onClick={recompute}
                disabled={recomputing}
                className="rounded-lg bg-surface-chip px-3 py-2 text-xs font-medium text-white hover:brightness-110 disabled:opacity-50"
              >
                {recomputing ? "Recomputing…" : "Recompute"}
              </button>
              <a
                href={`${env.apiUrl}/api/v1/class-sessions/${params.sessionId}/attendance/export.csv`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-brand-500 px-3 py-2 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                onClick={(e) => {
                  // The export endpoint requires auth like everything else; a plain
                  // anchor tag can't send an Authorization header, so route it
                  // through fetch + blob download instead of a raw href navigation.
                  e.preventDefault();
                  if (!exporting) downloadCsv();
                }}
              >
                {exporting ? "Exporting…" : "Export CSV"}
              </a>
            </div>
          </div>
          {recomputeError && <p className="mt-2 text-right text-xs text-danger">{recomputeError}</p>}
          {exportError && <p className="mt-2 text-right text-xs text-danger">{exportError}</p>}
        </div>

        {loadError ? (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-6 text-center text-sm text-danger">
            {loadError}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs uppercase text-ink-muted">
                <th className="py-2">Student</th>
                <th className="py-2">Joined</th>
                <th className="py-2">Left</th>
                <th className="py-2">Duration</th>
                <th className="py-2">Rejoins</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId} className="border-b border-surface-border/50">
                  <td className="py-2 text-white">{r.user.displayName}</td>
                  <td className="py-2 text-ink-muted">
                    {r.joinedAt ? new Date(r.joinedAt).toLocaleTimeString() : "—"}
                  </td>
                  <td className="py-2 text-ink-muted">
                    {r.leftAt ? new Date(r.leftAt).toLocaleTimeString() : "—"}
                  </td>
                  <td className="py-2 text-ink-muted">{Math.round(r.durationSeconds / 60)} min</td>
                  <td className="py-2 text-ink-muted">{r.rejoinCount}</td>
                  <td className={`py-2 font-medium ${STATUS_COLOR[r.status]}`}>{r.status}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-ink-muted">
                    No attendance data yet — click Recompute after the session has had participants
                    join.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
