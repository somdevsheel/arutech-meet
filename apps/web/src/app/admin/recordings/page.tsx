"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface AdminRecording {
  id: string;
  status: string;
  sizeBytes: string | null;
  durationSeconds: number | null;
  startedAt: string;
  expiresAt: string | null;
  meeting: { title: string; code: string };
}

export default function AdminRecordingsPage() {
  const [recordings, setRecordings] = useState<AdminRecording[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    apiFetch<{ recordings: AdminRecording[]; total: number }>("/admin/recordings?take=50&skip=0").then(
      (data) => {
        setRecordings(data.recordings);
        setTotal(data.total);
      },
    );
  }, []);

  const totalBytes = recordings.reduce((sum, r) => sum + Number(r.sizeBytes ?? 0), 0);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-white">Recordings ({total})</h1>
      <p className="mb-6 text-sm text-slate-500">{formatBytes(totalBytes)} across this page</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-border text-left text-xs uppercase text-slate-500">
            <th className="py-2">Meeting</th>
            <th className="py-2">Status</th>
            <th className="py-2">Size</th>
            <th className="py-2">Duration</th>
            <th className="py-2">Started</th>
            <th className="py-2">Expires</th>
          </tr>
        </thead>
        <tbody>
          {recordings.map((r) => (
            <tr key={r.id} className="border-b border-surface-border/50">
              <td className="py-2 text-white">
                {r.meeting.title} <span className="text-slate-500">({r.meeting.code})</span>
              </td>
              <td className="py-2 text-slate-400">{r.status}</td>
              <td className="py-2 text-slate-400">{r.sizeBytes ? formatBytes(Number(r.sizeBytes)) : "—"}</td>
              <td className="py-2 text-slate-400">
                {r.durationSeconds ? `${Math.round(r.durationSeconds / 60)} min` : "—"}
              </td>
              <td className="py-2 text-slate-400">{new Date(r.startedAt).toLocaleString()}</td>
              <td className="py-2 text-slate-400">
                {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "—"}
              </td>
            </tr>
          ))}
          {recordings.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-slate-500">
                No recordings yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
