"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { ModalShell } from "@/components/dashboard/schedule-meeting-modal";

interface Contact {
  id: string;
  displayName: string;
  username: string;
}

interface RoomSummary {
  id: string;
  type: "GROUP" | "DIRECT" | "MEETING" | "CLASS";
  name: string | null;
  members: {
    userId: string;
    lastReadMessageId: string | null;
    user: { id: string; displayName: string; username: string; avatarUrl: string | null };
  }[];
}

export function NewRoomModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (room: RoomSummary) => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Contact[]>("/contacts").then(setContacts).catch(() => setContacts([]));
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    if (selected.size === 0) {
      setError("Pick at least one person.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const type = selected.size === 1 && !name.trim() ? "DIRECT" : "GROUP";
      const room = await apiFetch<RoomSummary>("/chat-rooms", {
        method: "POST",
        body: JSON.stringify({
          type,
          name: type === "GROUP" ? name.trim() || "New group" : undefined,
          memberUserIds: [...selected],
        }),
      });
      onCreated(room);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create chat");
    } finally {
      setCreating(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="New chat">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Group name (optional — leave blank for a direct message)
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Design team" className="input" />
        </label>

        <div>
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-muted">People</span>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-surface-border">
            {contacts.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-ink-muted">
                No contacts yet — join a meeting with someone first.
              </p>
            )}
            {contacts.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2.5 border-b border-surface-border/60 px-3 py-2 last:border-0 hover:bg-surface-field"
              >
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                <span className="text-sm text-ink-2">{c.displayName}</span>
                <span className="text-xs text-ink-muted">@{c.username}</span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="mt-1 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-ink-3 hover:bg-surface-field">
            Cancel
          </button>
          <button
            onClick={create}
            disabled={creating}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Start chat"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
