"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface AdminReport {
  id: string;
  reason: string;
  details: string | null;
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  reporter: { id: string; displayName: string; email: string };
  reportedUser: { id: string; displayName: string; email: string } | null;
  reportedGuestName?: string | null;
  resolvedBy: { id: string; displayName: string } | null;
  meeting: { id: string; code: string; title: string } | null;
}

const REASON_LABEL: Record<string, string> = {
  HARASSMENT: "Harassment",
  SPAM: "Spam",
  INAPPROPRIATE_CONTENT: "Inappropriate content",
  IMPERSONATION: "Impersonation",
  OTHER: "Other",
};

/** A real admin review queue for complaints participants raise about each
 * other in meetings — see the Report schema comment for how this is
 * distinct from the audit log (actions taken) and from the immediate,
 * no-review Block action. */
export default function AdminReportsPage() {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<"OPEN" | "RESOLVED" | "DISMISSED" | "">("OPEN");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  function refresh() {
    const qs = statusFilter ? `?status=${statusFilter}&take=100&skip=0` : "?take=100&skip=0";
    return apiFetch<{ reports: AdminReport[]; total: number }>(`/admin/reports${qs}`).then((data) => {
      setReports(data.reports);
      setTotal(data.total);
    });
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function resolve(id: string, status: "RESOLVED" | "DISMISSED") {
    setBusyId(id);
    try {
      await apiFetch(`/admin/reports/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, resolutionNote: noteById[id]?.trim() || undefined }),
      });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-semibold text-white">Reports ({total})</h1>
          <p className="text-sm text-ink-muted">
            Complaints participants have filed about each other during a meeting — real behavior reported by
            real people, reviewed here, not silently dropped.
          </p>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="input w-40"
        >
          <option value="OPEN">Open</option>
          <option value="RESOLVED">Resolved</option>
          <option value="DISMISSED">Dismissed</option>
          <option value="">All</option>
        </select>
      </div>

      <div className="flex flex-col gap-3">
        {reports.length === 0 && (
          <p className="rounded-lg border border-dashed border-surface-border px-4 py-10 text-center text-sm text-ink-muted">
            No reports {statusFilter ? statusFilter.toLowerCase() : ""}.
          </p>
        )}
        {reports.map((r) => (
          <div key={r.id} className="rounded-xl border border-surface-border p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">
                  {REASON_LABEL[r.reason] ?? r.reason}
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      r.status === "OPEN"
                        ? "bg-warn/20 text-warn"
                        : r.status === "RESOLVED"
                          ? "bg-success/20 text-success"
                          : "bg-surface-chip text-ink-muted"
                    }`}
                  >
                    {r.status}
                  </span>
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  Reported by {r.reporter.displayName} ({r.reporter.email}) against{" "}
                  {r.reportedUser ? `${r.reportedUser.displayName} (${r.reportedUser.email})` : r.reportedGuestName ?? "a guest"}
                  {r.meeting && <> · in “{r.meeting.title}” ({r.meeting.code})</>}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-muted2">{new Date(r.createdAt).toLocaleString()}</p>
                {r.details && <p className="mt-2 text-xs text-ink-2">{r.details}</p>}
                {r.status !== "OPEN" && (
                  <p className="mt-2 text-xs text-ink-muted">
                    {r.status === "RESOLVED" ? "Resolved" : "Dismissed"} by {r.resolvedBy?.displayName ?? "—"}
                    {r.resolutionNote && <> — “{r.resolutionNote}”</>}
                  </p>
                )}
              </div>

              {r.status === "OPEN" && (
                <div className="flex flex-none flex-col items-end gap-2">
                  <input
                    value={noteById[r.id] ?? ""}
                    onChange={(e) => setNoteById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    placeholder="Resolution note (optional)"
                    className="input w-56 text-xs"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => resolve(r.id, "RESOLVED")}
                      disabled={busyId === r.id}
                      className="rounded-lg bg-success/20 px-3 py-1.5 text-xs font-medium text-success hover:brightness-110 disabled:opacity-50"
                    >
                      Resolve
                    </button>
                    <button
                      onClick={() => resolve(r.id, "DISMISSED")}
                      disabled={busyId === r.id}
                      className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-ink-3 hover:brightness-110 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
