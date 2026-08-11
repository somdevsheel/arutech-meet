"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { env } from "@/lib/env";
import { useAuthStore } from "@/lib/auth-store";

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
  PRESENT: "text-green-400",
  PARTIAL: "text-amber-400",
  ABSENT: "text-red-400",
};

export default function AttendancePage() {
  const params = useParams<{ id: string; sessionId: string }>();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [recomputing, setRecomputing] = useState(false);

  async function refresh() {
    const data = await apiFetch<AttendanceRow[]>(`/class-sessions/${params.sessionId}/attendance`);
    setRows(data);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.sessionId]);

  async function recompute() {
    setRecomputing(true);
    try {
      await apiFetch(`/class-sessions/${params.sessionId}/attendance/recompute`, { method: "POST" });
      await refresh();
    } finally {
      setRecomputing(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href={`/classes/${params.id}`} className="text-sm text-slate-400 hover:text-white">
        ← Class
      </Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Attendance</h1>
        <div className="flex gap-3">
          <button
            onClick={recompute}
            disabled={recomputing}
            className="rounded-lg bg-surface-border px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {recomputing ? "Recomputing…" : "Recompute"}
          </button>
          <a
            href={`${env.apiUrl}/api/v1/class-sessions/${params.sessionId}/attendance/export.csv`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-brand-500 px-3 py-2 text-xs font-medium text-white"
            onClick={(e) => {
              // The export endpoint requires auth like everything else; a plain
              // anchor tag can't send an Authorization header, so route it
              // through fetch + blob download instead of a raw href navigation.
              e.preventDefault();
              downloadCsv(params.sessionId, accessToken);
            }}
          >
            Export CSV
          </a>
        </div>
      </div>

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b border-surface-border text-left text-xs uppercase text-slate-500">
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
              <td className="py-2 text-slate-400">{r.joinedAt ? new Date(r.joinedAt).toLocaleTimeString() : "—"}</td>
              <td className="py-2 text-slate-400">{r.leftAt ? new Date(r.leftAt).toLocaleTimeString() : "—"}</td>
              <td className="py-2 text-slate-400">{Math.round(r.durationSeconds / 60)} min</td>
              <td className="py-2 text-slate-400">{r.rejoinCount}</td>
              <td className={`py-2 font-medium ${STATUS_COLOR[r.status]}`}>{r.status}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-slate-500">
                No attendance data yet — click Recompute after the session has had participants join.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}

async function downloadCsv(sessionId: string, accessToken: string | null) {
  const res = await fetch(`${env.apiUrl}/api/v1/class-sessions/${sessionId}/attendance/export.csv`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "attendance.csv";
  a.click();
  URL.revokeObjectURL(url);
}
