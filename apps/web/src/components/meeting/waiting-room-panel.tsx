"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface WaitingEntry {
  id: string;
  guestName: string | null;
  createdAt: string;
  user: { displayName: string; avatarUrl: string | null } | null;
}

/** Host-only panel: lists everyone currently parked in the waiting room and lets the
 * host admit or deny them. Re-fetches whenever `refreshSignal` changes (bumped by the
 * socket's WAITING_ROOM_JOINED event) rather than polling on a timer. */
export function WaitingRoomPanel({
  meetingId,
  refreshSignal,
}: {
  meetingId: string;
  refreshSignal: number;
}) {
  const [entries, setEntries] = useState<WaitingEntry[]>([]);

  useEffect(() => {
    apiFetch<WaitingEntry[]>(`/meetings/${meetingId}/participants/waiting-room`)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [meetingId, refreshSignal]);

  async function decide(participantId: string, action: "admit" | "deny") {
    await apiFetch(`/meetings/${meetingId}/participants/${participantId}/${action}`, {
      method: "POST",
    });
    setEntries((prev) => prev.filter((e) => e.id !== participantId));
  }

  if (entries.length === 0) return null;

  return (
    <div className="border-b border-surface-border bg-amber-500/10 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-300">
        Waiting room — {entries.length}
      </p>
      <ul className="space-y-2">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between text-sm text-white">
            <span>{e.user?.displayName ?? e.guestName ?? "Guest"}</span>
            <span className="flex gap-2">
              <button
                onClick={() => decide(e.id, "admit")}
                className="rounded bg-brand-500 px-2 py-1 text-xs hover:bg-brand-600"
              >
                Admit
              </button>
              <button
                onClick={() => decide(e.id, "deny")}
                className="rounded bg-surface-border px-2 py-1 text-xs hover:bg-danger-strong"
              >
                Deny
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
