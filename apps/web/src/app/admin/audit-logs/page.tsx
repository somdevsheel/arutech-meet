"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface AdminAuditLog {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
  actor: { displayName: string; email: string } | null;
}

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    apiFetch<{ logs: AdminAuditLog[]; total: number }>("/admin/audit-logs?take=100&skip=0").then((data) => {
      setLogs(data.logs);
      setTotal(data.total);
    });
  }, []);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-white">Audit Logs ({total})</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Privileged actions only (participant removal, role promotion, recording deletion, admin account
        actions) — not every request. See docs/security.md.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-border text-left text-xs uppercase text-ink-muted">
            <th className="py-2">Actor</th>
            <th className="py-2">Action</th>
            <th className="py-2">Target</th>
            <th className="py-2">When</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id} className="border-b border-surface-border/50">
              <td className="py-2 text-white">{l.actor?.displayName ?? "System"}</td>
              <td className="py-2 text-ink-muted">{l.action}</td>
              <td className="py-2 text-ink-muted">
                {l.targetType ? `${l.targetType}:${l.targetId}` : "—"}
              </td>
              <td className="py-2 text-ink-muted">{new Date(l.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-ink-muted">
                No audit events recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
