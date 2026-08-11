"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";

interface ClassSummary {
  id: string;
  title: string;
  subject: string | null;
  createdAt: string;
}

export default function ClassesPage() {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    apiFetch<ClassSummary[]>("/classes").then(setClasses);
  }, [accessToken, router]);

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

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Classes</h1>
        <Link href="/dashboard" className="text-sm text-slate-400 hover:text-white">
          ← Dashboard
        </Link>
      </div>

      <div className="mb-10 space-y-2 rounded-xl border border-surface-border bg-surface-raised p-4">
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
          className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create class"}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <ul className="space-y-2">
        {classes.length === 0 && <li className="text-sm text-slate-500">No classes yet.</li>}
        {classes.map((c) => (
          <li key={c.id}>
            <Link
              href={`/classes/${c.id}`}
              className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-raised px-4 py-3 hover:border-brand-500"
            >
              <div>
                <p className="text-sm font-medium text-white">{c.title}</p>
                {c.subject && <p className="text-xs text-slate-500">{c.subject}</p>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
