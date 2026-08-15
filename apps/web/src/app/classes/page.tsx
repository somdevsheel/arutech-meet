"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/layout/app-shell";

interface ClassSummary {
  id: string;
  title: string;
  subject: string | null;
  createdAt: string;
}

export default function ClassesPage() {
  const router = useRouter();
  const { user, accessToken, clear, hasHydrated } = useAuthStore();
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // See auth-store.ts: the persisted session hydrates asynchronously, so this
    // must wait for it before treating a fresh page load as "logged out".
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    apiFetch<ClassSummary[]>("/classes").then(setClasses);
  }, [hasHydrated, accessToken, router]);

  async function createClass() {
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const klass = await apiFetch<ClassSummary>("/classes", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), subject: subject.trim() || undefined }),
      });
      router.push(`/classes/${klass.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create class");
    } finally {
      setCreating(false);
    }
  }

  if (!user) return null;

  return (
    <AppShell
      user={user}
      active="classes"
      accessToken={accessToken}
      onSignOut={() => {
        clear();
        router.push("/");
      }}
    >
      <div className="flex flex-col gap-7">
        <h1 className="text-2xl font-semibold tracking-tight">Classes</h1>

        <div className="flex flex-col gap-3 rounded-xl border border-surface-border bg-surface-raised p-5">
          <div className="flex gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Class title (e.g. Algebra II)"
              className="input"
            />
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject (optional)"
              className="input"
            />
          </div>
          <button
            onClick={createClass}
            disabled={creating}
            className="self-start rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create class"}
          </button>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <ul className="flex flex-col gap-2">
          {classes.length === 0 && <li className="text-sm text-ink-muted">No classes yet.</li>}
          {classes.map((c) => (
            <li key={c.id}>
              <Link
                href={`/classes/${c.id}`}
                className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-raised px-4 py-3 transition hover:border-brand-500"
              >
                <div>
                  <p className="text-sm font-medium text-white">{c.title}</p>
                  {c.subject && <p className="text-xs text-ink-muted">{c.subject}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
