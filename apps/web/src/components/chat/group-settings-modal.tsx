"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { ModalShell } from "@/components/dashboard/schedule-meeting-modal";

interface RoomMember {
  userId: string;
  isAdmin: boolean;
  lastReadMessageId: string | null;
  user: { id: string; displayName: string; username: string; avatarUrl: string | null; lastSeenAt: string };
}

interface RoomSummary {
  id: string;
  type: "GROUP" | "DIRECT" | "MEETING" | "CLASS";
  name: string | null;
  photoUrl: string | null;
  members: RoomMember[];
}

interface Contact {
  id: string;
  displayName: string;
  username: string;
}

/** GROUP-room management — rename/photo, member list with admin badges, and
 * (admin-only) add/remove members and promote/demote admins. A non-admin
 * member sees the same member list read-only, with none of the management
 * controls, matching the server-side gating in ChatService (admin-only
 * endpoints, not just hidden buttons). */
export function GroupSettingsModal({
  room,
  currentUserId,
  onClose,
  onUpdated,
}: {
  room: RoomSummary;
  currentUserId: string;
  onClose: () => void;
  onUpdated: (room: RoomSummary) => void;
}) {
  const [name, setName] = useState(room.name ?? "");
  const [photoUrl, setPhotoUrl] = useState(room.photoUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const myMembership = room.members.find((m) => m.userId === currentUserId);
  const isAdmin = Boolean(myMembership?.isAdmin);

  useEffect(() => {
    if (showAddMember) {
      apiFetch<Contact[]>("/contacts").then(setContacts).catch(() => setContacts([]));
    }
  }, [showAddMember]);

  async function saveDetails() {
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<RoomSummary>(`/chat-rooms/${room.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim() || undefined,
          photoUrl: photoUrl.trim() || undefined,
        }),
      });
      onUpdated({ ...room, ...updated });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function addMember(userId: string) {
    setBusyUserId(userId);
    setError(null);
    try {
      await apiFetch(`/chat-rooms/${room.id}/members`, { method: "POST", body: JSON.stringify({ userId }) });
      onUpdated({
        ...room,
        members: [
          ...room.members,
          {
            userId,
            isAdmin: false,
            lastReadMessageId: null,
            user: contacts.find((c) => c.id === userId) as unknown as RoomMember["user"],
          },
        ],
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add member");
    } finally {
      setBusyUserId(null);
    }
  }

  async function removeMember(userId: string) {
    setBusyUserId(userId);
    try {
      await apiFetch(`/chat-rooms/${room.id}/members/${userId}`, { method: "DELETE" });
      onUpdated({ ...room, members: room.members.filter((m) => m.userId !== userId) });
    } finally {
      setBusyUserId(null);
    }
  }

  async function promote(userId: string) {
    setBusyUserId(userId);
    try {
      await apiFetch(`/chat-rooms/${room.id}/admins/${userId}`, { method: "POST" });
      onUpdated({
        ...room,
        members: room.members.map((m) => (m.userId === userId ? { ...m, isAdmin: true } : m)),
      });
    } finally {
      setBusyUserId(null);
    }
  }

  async function demote(userId: string) {
    setBusyUserId(userId);
    setError(null);
    try {
      await apiFetch(`/chat-rooms/${room.id}/admins/${userId}`, { method: "DELETE" });
      onUpdated({
        ...room,
        members: room.members.map((m) => (m.userId === userId ? { ...m, isAdmin: false } : m)),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to demote");
    } finally {
      setBusyUserId(null);
    }
  }

  const nonMemberContacts = contacts.filter((c) => !room.members.some((m) => m.userId === c.id));

  return (
    <ModalShell onClose={onClose} title="Group settings">
      <div className="flex flex-col gap-5">
        {isAdmin && (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Group name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Photo URL (optional)
              </span>
              <input
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
                placeholder="https://…"
                className="input"
              />
            </label>
            <button
              onClick={saveDetails}
              disabled={saving}
              className="self-start rounded-lg bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Members ({room.members.length})
            </span>
            {isAdmin && (
              <button
                onClick={() => setShowAddMember((v) => !v)}
                className="text-xs font-medium text-brand-300 hover:underline"
              >
                {showAddMember ? "Cancel" : "+ Add member"}
              </button>
            )}
          </div>

          {showAddMember && (
            <div className="mb-3 max-h-40 overflow-y-auto rounded-lg border border-surface-border">
              {nonMemberContacts.length === 0 && (
                <p className="px-3 py-3 text-center text-xs text-ink-muted">No contacts left to add.</p>
              )}
              {nonMemberContacts.map((c) => (
                <button
                  key={c.id}
                  onClick={() => addMember(c.id)}
                  disabled={busyUserId === c.id}
                  className="flex w-full items-center justify-between border-b border-surface-border/60 px-3 py-2 text-left text-xs last:border-0 hover:bg-surface-field disabled:opacity-50"
                >
                  <span className="text-ink-2">{c.displayName}</span>
                  <span className="text-ink-muted">@{c.username}</span>
                </button>
              ))}
            </div>
          )}

          <ul className="flex flex-col gap-1.5">
            {room.members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center justify-between rounded-lg bg-surface-field px-3 py-2 text-xs"
              >
                <span className="flex items-center gap-2 text-ink-2">
                  {m.user.displayName}
                  {m.userId === currentUserId && <span className="text-ink-muted">(you)</span>}
                  {m.isAdmin && (
                    <span className="rounded-full bg-brand-500/20 px-1.5 py-0.5 text-[10px] font-medium text-brand-300">
                      Admin
                    </span>
                  )}
                </span>
                {isAdmin && m.userId !== currentUserId && (
                  <span className="flex gap-2">
                    {m.isAdmin ? (
                      <button
                        onClick={() => demote(m.userId)}
                        disabled={busyUserId === m.userId}
                        className="text-ink-muted hover:text-white disabled:opacity-50"
                      >
                        Remove admin
                      </button>
                    ) : (
                      <button
                        onClick={() => promote(m.userId)}
                        disabled={busyUserId === m.userId}
                        className="text-brand-300 hover:underline disabled:opacity-50"
                      >
                        Make admin
                      </button>
                    )}
                    <button
                      onClick={() => removeMember(m.userId)}
                      disabled={busyUserId === m.userId}
                      className="text-danger hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-ink-3 hover:bg-surface-field">
            Close
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
