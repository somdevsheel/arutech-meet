"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { useCallStore } from "@/lib/call-store";
import { AppShell } from "@/components/layout/app-shell";

interface Contact {
  id: string;
  displayName: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  meetingsTogether: number;
  lastMetAt: string;
  isFavorite: boolean;
  groupIds: string[];
}

interface BlockedContact {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
}

interface ContactGroup {
  id: string;
  name: string;
  members: { contactUserId: string; contact: { id: string; displayName: string; avatarUrl: string | null } }[];
}

interface CallHistoryEntry {
  callId: string;
  type: "AUDIO" | "VIDEO";
  status: "RINGING" | "ONGOING" | "MISSED" | "DECLINED" | "ENDED" | "CANCELED";
  startedAt: string | null;
  endedAt: string | null;
  wasIncoming: boolean;
  otherParticipants: { id: string; displayName: string; avatarUrl: string | null }[];
}

const CALL_STATUS_LABEL: Record<CallHistoryEntry["status"], string> = {
  RINGING: "Ringing",
  ONGOING: "Ongoing",
  MISSED: "Missed",
  DECLINED: "Declined",
  ENDED: "",
  CANCELED: "Canceled",
};

function callDuration(entry: CallHistoryEntry): string | null {
  if (!entry.startedAt || !entry.endedAt) return null;
  const seconds = Math.round((new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)} min`;
}

function initialsOf(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

/** Real directory — everyone the caller has actually shared a meeting with,
 * derived from MeetingParticipant history (see ContactsService), not a
 * separately-maintained address book. Block/favorite/group are the one
 * exception: real per-user state (BlockedUser/ContactFavorite/ContactGroup)
 * layered on top of that derived list. */
export default function ContactsPage() {
  const router = useRouter();
  const { user, accessToken, clear, hasHydrated } = useAuthStore();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [blocked, setBlocked] = useState<BlockedContact[] | null>(null);
  const [groups, setGroups] = useState<ContactGroup[] | null>(null);
  const [showBlocked, setShowBlocked] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupPickerFor, setGroupPickerFor] = useState<string | null>(null);
  const [callHistory, setCallHistory] = useState<CallHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startCall = useCallStore((s) => s.startCall);
  const callPhase = useCallStore((s) => s.phase);

  function refreshContacts() {
    return apiFetch<Contact[]>("/contacts")
      .then(setContacts)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load contacts"));
  }
  function refreshBlocked() {
    return apiFetch<BlockedContact[]>("/contacts/blocked").then(setBlocked);
  }
  function refreshGroups() {
    return apiFetch<ContactGroup[]>("/contacts/groups").then(setGroups);
  }

  useEffect(() => {
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    refreshContacts();
    refreshBlocked();
    refreshGroups();
    apiFetch<CallHistoryEntry[]>("/calls/history")
      .then(setCallHistory)
      .catch(() => setCallHistory([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, accessToken, router]);

  // Refresh call history once the current call ends, so a call just made
  // shows up without needing a manual page reload.
  useEffect(() => {
    if (callPhase === "idle") {
      apiFetch<CallHistoryEntry[]>("/calls/history").then(setCallHistory).catch(() => {});
    }
  }, [callPhase]);

  async function call(contact: Contact, type: "AUDIO" | "VIDEO") {
    await startCall({ id: contact.id, displayName: contact.displayName, avatarUrl: contact.avatarUrl }, type);
  }

  async function message(contact: Contact) {
    const room = await apiFetch<{ id: string }>("/chat-rooms", {
      method: "POST",
      body: JSON.stringify({ type: "DIRECT", memberUserIds: [contact.id] }),
    });
    router.push(`/chat?room=${room.id}`);
  }

  async function toggleFavorite(contact: Contact) {
    if (contact.isFavorite) {
      await apiFetch(`/contacts/${contact.id}/favorite`, { method: "DELETE" });
    } else {
      await apiFetch(`/contacts/${contact.id}/favorite`, { method: "POST" });
    }
    refreshContacts();
  }

  async function blockContact(contact: Contact) {
    setError(null);
    try {
      await apiFetch("/contacts/blocked", { method: "POST", body: JSON.stringify({ userId: contact.id }) });
      await Promise.all([refreshContacts(), refreshBlocked()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to block");
    }
  }

  async function unblock(contact: BlockedContact) {
    await apiFetch(`/contacts/blocked/${contact.id}`, { method: "DELETE" });
    await Promise.all([refreshContacts(), refreshBlocked()]);
  }

  async function createGroup() {
    if (!newGroupName.trim()) return;
    await apiFetch("/contacts/groups", { method: "POST", body: JSON.stringify({ name: newGroupName.trim() }) });
    setNewGroupName("");
    refreshGroups();
  }

  async function deleteGroup(groupId: string) {
    await apiFetch(`/contacts/groups/${groupId}`, { method: "DELETE" });
    refreshGroups();
  }

  async function addToGroup(groupId: string, contactUserId: string) {
    setGroupPickerFor(null);
    try {
      await apiFetch(`/contacts/groups/${groupId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: contactUserId }),
      });
      await Promise.all([refreshGroups(), refreshContacts()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add to group");
    }
  }

  async function removeFromGroup(groupId: string, contactUserId: string) {
    await apiFetch(`/contacts/groups/${groupId}/members/${contactUserId}`, { method: "DELETE" });
    await Promise.all([refreshGroups(), refreshContacts()]);
  }

  if (!user) return null;

  const groupById = new Map((groups ?? []).map((g) => [g.id, g]));

  return (
    <AppShell
      user={user}
      active="contacts"
      accessToken={accessToken}
      onSignOut={() => {
        clear();
        router.push("/");
      }}
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
            <p className="mt-1 text-[13px] text-ink-muted">
              Everyone you&rsquo;ve shared a meeting with — this list builds itself.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowGroups((v) => !v)}
              className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-ink-3 hover:brightness-110"
            >
              Groups{groups && groups.length > 0 ? ` (${groups.length})` : ""}
            </button>
            <button
              onClick={() => setShowBlocked((v) => !v)}
              className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-ink-3 hover:brightness-110"
            >
              Blocked{blocked && blocked.length > 0 ? ` (${blocked.length})` : ""}
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        {showGroups && (
          <div className="rounded-lg border border-surface-border bg-surface-raised p-4">
            <div className="mb-3 flex gap-2">
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="New group name"
                className="input"
              />
              <button
                onClick={createGroup}
                disabled={!newGroupName.trim()}
                className="flex-none rounded-lg bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
              >
                Create
              </button>
            </div>
            <ul className="flex flex-col gap-2">
              {groups?.length === 0 && <li className="text-xs text-ink-muted">No groups yet.</li>}
              {groups?.map((g) => (
                <li key={g.id} className="rounded-md bg-surface-field p-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink-2">
                      {g.name} <span className="text-ink-muted2">({g.members.length})</span>
                    </span>
                    <button onClick={() => deleteGroup(g.id)} className="text-danger hover:underline">
                      Delete group
                    </button>
                  </div>
                  {g.members.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {g.members.map((m) => (
                        <span
                          key={m.contactUserId}
                          className="flex items-center gap-1 rounded-full bg-surface-raised px-2 py-0.5 text-[11px] text-ink-3"
                        >
                          {m.contact.displayName}
                          <button
                            onClick={() => removeFromGroup(g.id, m.contactUserId)}
                            aria-label={`Remove ${m.contact.displayName} from ${g.name}`}
                            className="text-ink-muted2 hover:text-danger"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {showBlocked && (
          <div className="rounded-lg border border-surface-border bg-surface-raised p-4">
            {blocked?.length === 0 && <p className="text-xs text-ink-muted">No one is blocked.</p>}
            <ul className="flex flex-col gap-2">
              {blocked?.map((b) => (
                <li key={b.id} className="flex items-center justify-between rounded-md bg-surface-field p-2.5 text-xs">
                  <span className="text-ink-2">{b.displayName}</span>
                  <button onClick={() => unblock(b)} className="text-brand-300 hover:underline">
                    Unblock
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {contacts === null && <p className="text-sm text-ink-muted">Loading…</p>}
        {contacts && contacts.length === 0 && (
          <div className="rounded-lg border border-dashed border-surface-border px-4 py-10 text-center text-sm text-ink-muted">
            No contacts yet — join a meeting with someone and they&rsquo;ll show up here.
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {contacts?.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 rounded-lg border border-surface-border bg-surface-raised px-4 py-3"
            >
              <button
                onClick={() => toggleFavorite(c)}
                title={c.isFavorite ? "Unfavorite" : "Favorite"}
                aria-label={c.isFavorite ? `Unfavorite ${c.displayName}` : `Favorite ${c.displayName}`}
                className={`flex-none text-lg ${c.isFavorite ? "text-warn" : "text-ink-muted2 hover:text-ink-3"}`}
              >
                {c.isFavorite ? "★" : "☆"}
              </button>
              <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-brand-500 text-xs font-semibold text-white">
                {initialsOf(c.displayName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{c.displayName}</p>
                <p className="truncate text-xs text-ink-muted">
                  @{c.username} · {c.meetingsTogether} meeting{c.meetingsTogether === 1 ? "" : "s"} together
                </p>
                {c.groupIds.length > 0 && (
                  <p className="mt-0.5 truncate text-[11px] text-ink-muted2">
                    {c.groupIds.map((gid) => groupById.get(gid)?.name).filter(Boolean).join(", ")}
                  </p>
                )}
              </div>

              {groups && groups.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setGroupPickerFor((cur) => (cur === c.id ? null : c.id))}
                    className="rounded-lg bg-surface-chip px-2.5 py-1.5 text-xs font-medium text-ink-3 hover:brightness-110"
                  >
                    + Group
                  </button>
                  {groupPickerFor === c.id && (
                    <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-lg border border-surface-border bg-surface-raised p-1 shadow-lg">
                      {groups
                        .filter((g) => !c.groupIds.includes(g.id))
                        .map((g) => (
                          <button
                            key={g.id}
                            onClick={() => addToGroup(g.id, c.id)}
                            className="block w-full rounded px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-surface-field"
                          >
                            {g.name}
                          </button>
                        ))}
                      {groups.every((g) => c.groupIds.includes(g.id)) && (
                        <p className="px-2 py-1.5 text-xs text-ink-muted">Already in every group.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={() => message(c)}
                className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-ink-3 hover:brightness-110"
              >
                Message
              </button>
              <button
                onClick={() => call(c, "AUDIO")}
                title="Voice call"
                aria-label={`Voice call ${c.displayName}`}
                className="grid h-8 w-8 place-items-center rounded-lg bg-surface-chip text-ink-3 hover:brightness-110"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4.5 3.5c1.3 0 2.5.4 3.5 1.1.4.3.5.8.4 1.3l-.9 2.9c-.1.4 0 .9.4 1.2 1.2 1 2.6 2 4.2 2.7.4.2.9.1 1.2-.2l2.2-2.2c.3-.3.8-.4 1.2-.2.9.4 2 .6 3 .6.6 0 1 .5 1 1v3.3c0 1.1-.9 2-2 2C10.6 20 4 13.4 4 5c0-.8.7-1.5 1.5-1.5Z" />
                </svg>
              </button>
              <button
                onClick={() => call(c, "VIDEO")}
                title="Video call"
                aria-label={`Video call ${c.displayName}`}
                className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600"
              >
                Call
              </button>
              <button
                onClick={() => blockContact(c)}
                title="Block"
                aria-label={`Block ${c.displayName}`}
                className="rounded-lg px-2 py-1.5 text-xs font-medium text-ink-muted2 hover:text-danger"
              >
                Block
              </button>
            </li>
          ))}
        </ul>

        {callHistory && callHistory.length > 0 && (
          <div>
            <h2 className="mb-2 text-sm font-semibold text-white">Recent calls</h2>
            <ul className="flex flex-col gap-1">
              {callHistory.map((entry) => {
                const other = entry.otherParticipants[0];
                const duration = callDuration(entry);
                return (
                  <li
                    key={entry.callId}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-elevated"
                  >
                    <span className={entry.status === "MISSED" ? "text-danger" : "text-ink-muted2"}>
                      {entry.type === "VIDEO" ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="6" width="12" height="12" rx="2" />
                          <path d="m15 11 6-4v10l-6-4" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4.5 3.5c1.3 0 2.5.4 3.5 1.1.4.3.5.8.4 1.3l-.9 2.9c-.1.4 0 .9.4 1.2 1.2 1 2.6 2 4.2 2.7.4.2.9.1 1.2-.2l2.2-2.2c.3-.3.8-.4 1.2-.2.9.4 2 .6 3 .6.6 0 1 .5 1 1v3.3c0 1.1-.9 2-2 2C10.6 20 4 13.4 4 5c0-.8.7-1.5 1.5-1.5Z" />
                        </svg>
                      )}
                    </span>
                    <span className="flex-none text-xs text-ink-muted2">{entry.wasIncoming ? "↓" : "↑"}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{other?.displayName ?? "Unknown"}</span>
                    <span className="flex-none text-xs text-ink-muted">
                      {CALL_STATUS_LABEL[entry.status]}
                      {duration ? ` · ${duration}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </AppShell>
  );
}
