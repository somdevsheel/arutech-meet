"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";

interface Meeting {
  id: string;
  code: string;
  title: string;
  type: string;
  status: string;
  createdAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, accessToken, clear } = useAuthStore();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function refresh() {
    try {
      const data = await apiFetch<Meeting[]>("/meetings");
      setMeetings(data);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    }
  }

  async function createInstantMeeting() {
    setCreating(true);
    setError(null);
    try {
      const meeting = await apiFetch<Meeting>("/meetings", {
        method: "POST",
        body: JSON.stringify({ title: title || "Instant Meeting", type: "INSTANT" }),
      });
      router.push(`/meeting/${meeting.code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create meeting");
    } finally {
      setCreating(false);
    }
  }

  if (!user) return null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Welcome, {user.displayName}</h1>
          <p className="text-sm text-slate-400">@{user.username}</p>
        </div>
        <button
          onClick={() => {
            clear();
            router.push("/");
          }}
          className="text-sm text-slate-400 hover:text-white"
        >
          Sign out
        </button>
      </div>

      <div className="mb-10 flex gap-2 rounded-xl border border-surface-border bg-surface-raised p-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Meeting title (optional)"
          className="input"
        />
        <button
          onClick={createInstantMeeting}
          disabled={creating}
          className="whitespace-nowrap rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {creating ? "Starting…" : "New meeting"}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
        Your meetings
      </h2>
      <ul className="space-y-2">
        {meetings.length === 0 && (
          <li className="text-sm text-slate-500">No meetings yet — start one above.</li>
        )}
        {meetings.map((m) => (
          <li key={m.id}>
            <Link
              href={`/meeting/${m.code}`}
              className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-raised px-4 py-3 hover:border-brand-500"
            >
              <div>
                <p className="text-sm font-medium text-white">{m.title}</p>
                <p className="text-xs text-slate-500">
                  {m.code} · {m.type} · {m.status}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
