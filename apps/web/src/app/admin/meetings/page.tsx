"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface AdminMeeting {
  id: string;
  code: string;
  title: string;
  type: string;
  status: string;
  createdAt: string;
  _count: { participants: number };
}

export default function AdminMeetingsPage() {
  const [meetings, setMeetings] = useState<AdminMeeting[]>([]);
  const [total, setTotal] = useState(0);
  const [onlyActive, setOnlyActive] = useState(false);

  async function refresh() {
    const params = new URLSearchParams({ take: "50", skip: "0" });
    if (onlyActive) params.set("status", "LIVE");
    const data = await apiFetch<{ meetings: AdminMeeting[]; total: number }>(`/admin/meetings?${params}`);
    setMeetings(data.meetings);
    setTotal(data.total);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyActive]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Meetings ({total})</h1>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          Active only
        </label>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-border text-left text-xs uppercase text-ink-muted">
            <th className="py-2">Title</th>
            <th className="py-2">Code</th>
            <th className="py-2">Type</th>
            <th className="py-2">Status</th>
            <th className="py-2">Participants</th>
            <th className="py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {meetings.map((m) => (
            <tr key={m.id} className="border-b border-surface-border/50">
              <td className="py-2 text-white">{m.title}</td>
              <td className="py-2 text-ink-muted">{m.code}</td>
              <td className="py-2 text-ink-muted">{m.type}</td>
              <td className={`py-2 font-medium ${m.status === "LIVE" ? "text-success" : "text-ink-muted"}`}>
                {m.status}
              </td>
              <td className="py-2 text-ink-muted">{m._count.participants}</td>
              <td className="py-2 text-ink-muted">{new Date(m.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {meetings.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-ink-muted">
                No meetings found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
