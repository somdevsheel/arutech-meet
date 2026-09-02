"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/layout/app-shell";
import { FullPageLoading } from "@/components/full-page-loading";

interface Note {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

export default function NotesPage() {
  const router = useRouter();
  const { user, accessToken, clear, hasHydrated } = useAuthStore();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = notes?.find((n) => n.id === selectedId) ?? null;

  useEffect(() => {
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, accessToken]);

  async function refresh() {
    try {
      const data = await apiFetch<Note[]>("/notes");
      setNotes(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load notes");
    }
  }

  useEffect(() => {
    setTitle(selected?.title ?? "");
    setBody(selected?.body ?? "");
  }, [selected]);

  async function createNote() {
    const note = await apiFetch<Note>("/notes", {
      method: "POST",
      body: JSON.stringify({ title: "Untitled note", body: "" }),
    });
    setNotes((prev) => [note, ...(prev ?? [])]);
    setSelectedId(note.id);
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await apiFetch<Note>(`/notes/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: title || "Untitled note", body }),
      });
      setNotes((prev) => prev?.map((n) => (n.id === updated.id ? updated : n)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save note");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await apiFetch(`/notes/${id}`, { method: "DELETE" });
    setNotes((prev) => prev?.filter((n) => n.id !== id) ?? null);
    if (selectedId === id) setSelectedId(null);
  }

  if (!user) return <FullPageLoading />;

  return (
    <AppShell
      user={user}
      active="notes"
      accessToken={accessToken}
      onSignOut={() => {
        clear();
        router.push("/");
      }}
    >
      <div className="flex h-full flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
            <p className="mt-1 text-[13px] text-ink-muted">Personal notes, private to you.</p>
          </div>
          <button
            onClick={createNote}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            New note
          </button>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
          <ul className="flex flex-col gap-1.5 overflow-y-auto">
            {notes?.length === 0 && <li className="text-sm text-ink-muted">No notes yet.</li>}
            {notes?.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => setSelectedId(n.id)}
                  className={`block w-full rounded-lg border px-3 py-2.5 text-left transition ${
                    selectedId === n.id
                      ? "border-brand-500 bg-brand-tint2"
                      : "border-surface-border bg-surface-raised hover:border-surface-border2"
                  }`}
                >
                  <p className="truncate text-sm font-medium text-white">{n.title || "Untitled note"}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {new Date(n.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          {selected ? (
            <div className="flex flex-col gap-3 rounded-xl border border-surface-border bg-surface-raised p-5">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                className="bg-transparent text-lg font-semibold text-white outline-none placeholder:text-ink-muted"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write something…"
                className="min-h-[300px] flex-1 resize-none bg-transparent text-sm leading-relaxed text-ink-2 outline-none placeholder:text-ink-muted"
              />
              <div className="flex justify-end gap-2 border-t border-surface-border pt-3">
                <button
                  onClick={() => remove(selected.id)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10"
                >
                  Delete
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-lg bg-brand-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-surface-border text-sm text-ink-muted">
              Select a note, or create a new one.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
