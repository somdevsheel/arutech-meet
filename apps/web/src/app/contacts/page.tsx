"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/layout/app-shell";

interface Contact {
  id: string;
  displayName: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  meetingsTogether: number;
  lastMetAt: string;
}

function initialsOf(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

/** Real directory — everyone the caller has actually shared a meeting with,
 * derived from MeetingParticipant history (see ContactsService), not a
 * separately-maintained address book. */
export default function ContactsPage() {
  const router = useRouter();
  const { user, accessToken, clear, hasHydrated } = useAuthStore();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callingId, setCallingId] = useState<string | null>(null);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    apiFetch<Contact[]>("/contacts")
      .then(setContacts)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load contacts"));
  }, [hasHydrated, accessToken, router]);

  async function call(contact: Contact) {
    setCallingId(contact.id);
    try {
      const meeting = await apiFetch<{ code: string }>("/contacts/call", {
        method: "POST",
        body: JSON.stringify({ userId: contact.id }),
      });
      router.push(`/meeting/${meeting.code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start call");
      setCallingId(null);
    }
  }

  async function message(contact: Contact) {
    const room = await apiFetch<{ id: string }>("/chat-rooms", {
      method: "POST",
      body: JSON.stringify({ type: "DIRECT", memberUserIds: [contact.id] }),
    });
    router.push(`/chat?room=${room.id}`);
  }

  if (!user) return null;

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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            Everyone you&rsquo;ve shared a meeting with — this list builds itself.
          </p>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

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
              <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-brand-500 text-xs font-semibold text-white">
                {initialsOf(c.displayName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{c.displayName}</p>
                <p className="truncate text-xs text-ink-muted">
                  @{c.username} · {c.meetingsTogether} meeting{c.meetingsTogether === 1 ? "" : "s"} together
                </p>
              </div>
              <button
                onClick={() => message(c)}
                className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-ink-3 hover:brightness-110"
              >
                Message
              </button>
              <button
                onClick={() => call(c)}
                disabled={callingId === c.id}
                className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {callingId === c.id ? "Starting…" : "Call"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
