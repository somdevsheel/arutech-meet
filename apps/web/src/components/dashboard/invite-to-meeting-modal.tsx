"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { ModalShell } from "./schedule-meeting-modal";

interface MeetingInvite {
  id: string;
  email: string;
  role: "CO_HOST" | "PARTICIPANT";
  createdAt: string;
}

/** There was never a way to invite a specific person to a meeting at all —
 * only a copyable link/code (meeting-info-panel.tsx's "Invite people").
 * `MeetingInvite` existed in the schema from the start (real scaffolding
 * waiting to be wired up, like `FileAsset`/`ChatRoom.photoUrl` before they
 * were) but nothing ever created, read, or exposed a single row through it.
 * This is that: real email + in-app notification, backed by
 * MeetingsService.inviteByEmail/listInvites/revokeInvite. */
export function InviteToMeetingModal({
  meetingId,
  meetingTitle,
  onClose,
}: {
  meetingId: string;
  meetingTitle: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [asCoHost, setAsCoHost] = useState(false);
  const [invites, setInvites] = useState<MeetingInvite[] | null>(null);
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  function refresh() {
    apiFetch<MeetingInvite[]>(`/meetings/${meetingId}/invites`)
      .then(setInvites)
      .catch(() => setInvites([]));
  }
  useEffect(refresh, [meetingId]);

  async function sendInvite() {
    if (!email.trim()) return;
    setSending(true);
    setError(null);
    setSent(null);
    try {
      await apiFetch(`/meetings/${meetingId}/invites`, {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), role: asCoHost ? "CO_HOST" : "PARTICIPANT" }),
      });
      setSent(email.trim());
      setEmail("");
      setAsCoHost(false);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send invite");
    } finally {
      setSending(false);
    }
  }

  async function revoke(inviteId: string) {
    setBusyId(inviteId);
    try {
      await apiFetch(`/meetings/${meetingId}/invites/${inviteId}`, { method: "DELETE" });
      setInvites((prev) => prev?.filter((i) => i.id !== inviteId) ?? null);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ModalShell onClose={onClose} title={`Invite people to "${meetingTitle}"`}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-white">Email address</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendInvite()}
            placeholder="teammate@example.com"
            className="input"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-ink-3">
          <input
            type="checkbox"
            checked={asCoHost}
            onChange={(e) => setAsCoHost(e.target.checked)}
            className="h-4 w-4 rounded border-surface-border2 bg-surface-field"
          />
          Invite as co-host
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}
        {sent && <p className="text-sm text-success">Invited {sent} — they&rsquo;ll get an email and, if they already have an account, a notification here too.</p>}

        <button
          onClick={sendInvite}
          disabled={sending || !email.trim()}
          className="self-start rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send invite"}
        </button>

        <div className="border-t border-surface-border pt-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">Pending invites</h3>
          {invites === null && <p className="text-xs text-ink-muted">Loading…</p>}
          {invites?.length === 0 && <p className="text-xs text-ink-muted">No pending invites yet.</p>}
          <ul className="flex flex-col gap-1.5">
            {invites?.map((invite) => (
              <li
                key={invite.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-surface-field px-3 py-2"
              >
                <span className="min-w-0 truncate text-sm text-ink-2">
                  {invite.email}
                  {invite.role === "CO_HOST" && (
                    <span className="ml-2 text-xs text-ink-muted">(co-host)</span>
                  )}
                </span>
                <button
                  onClick={() => revoke(invite.id)}
                  disabled={busyId === invite.id}
                  className="flex-none rounded-lg px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-ink-3 hover:bg-surface-field">
            Done
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
