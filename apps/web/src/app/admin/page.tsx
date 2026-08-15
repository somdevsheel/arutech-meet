"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface Stats {
  totalUsers: number;
  activeSessions: number;
  totalOrganizations: number;
  meetingsToday: number;
  activeMeetings: number;
  classesToday: number;
  totalRecordings: number;
  recordingStorageBytes: string;
  notes: { activeSessions: string; omitted: string };
}

interface SystemHealth {
  postgres: string;
  apiProcess: { uptimeSeconds: number; nodeVersion: string; memoryUsageMb: number };
  recordingFailuresLast24h: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);

  useEffect(() => {
    apiFetch<Stats>("/admin/stats").then(setStats);
    apiFetch<SystemHealth>("/admin/system-health").then(setHealth);
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-white">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Total users" value={stats?.totalUsers} />
        <StatCard label="Active sessions (30d)" value={stats?.activeSessions} />
        <StatCard label="Organizations" value={stats?.totalOrganizations} />
        <StatCard label="Meetings today" value={stats?.meetingsToday} />
        <StatCard label="Active meetings now" value={stats?.activeMeetings} highlight />
        <StatCard label="Classes today" value={stats?.classesToday} />
        <StatCard label="Recordings" value={stats?.totalRecordings} />
        <StatCard
          label="Recording storage"
          value={stats ? formatBytes(Number(stats.recordingStorageBytes)) : undefined}
        />
      </div>

      {stats && (
        <p className="mt-4 text-xs text-ink-muted">
          {stats.notes.activeSessions} {stats.notes.omitted}
        </p>
      )}

      <h2 className="mb-3 mt-10 text-sm font-medium uppercase tracking-wide text-ink-muted">
        System health
      </h2>
      {health && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="PostgreSQL" value={health.postgres} ok={health.postgres === "ok"} />
          <StatCard label="API uptime" value={`${Math.round(health.apiProcess.uptimeSeconds / 60)} min`} />
          <StatCard label="API memory" value={`${health.apiProcess.memoryUsageMb} MB`} />
          <StatCard
            label="Recording failures (24h)"
            value={health.recordingFailuresLast24h}
            ok={health.recordingFailuresLast24h === 0}
          />
        </div>
      )}
      <p className="mt-4 text-xs text-ink-muted">
        Bandwidth, packet loss/jitter, and connection-quality metrics require the observability stack
        (Prometheus/OpenTelemetry — see docs/roadmap.md Stage 10) and are not shown here rather than faked.
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
  ok,
}: {
  label: string;
  value: string | number | undefined;
  highlight?: boolean;
  ok?: boolean;
}) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface-raised p-4">
      <p className="text-xs text-ink-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          ok === false ? "text-danger" : ok === true ? "text-success" : highlight ? "text-brand-300" : "text-white"
        }`}
      >
        {value ?? "—"}
      </p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
