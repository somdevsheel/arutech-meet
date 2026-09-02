"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/layout/app-shell";
import { FullPageLoading } from "@/components/full-page-loading";

interface Session {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current?: boolean;
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, accessToken, clear, hasHydrated, setSession } = useAuthStore();
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    if (user) setDisplayName(user.displayName);
    apiFetch<Session[]>("/users/me/sessions")
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [hasHydrated, accessToken, user, router]);

  async function save() {
    if (!user || !accessToken) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await apiFetch<typeof user>("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ displayName }),
      });
      // Keep the session store (and everywhere it's read from — topbar,
      // avatars) in sync with what was just saved, without forcing a re-login.
      setSession(updated, accessToken, useAuthStore.getState().refreshToken ?? "");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!user) return <FullPageLoading />;

  return (
    <AppShell
      user={user}
      active="home"
      accessToken={accessToken}
      onSignOut={() => {
        clear();
        router.push("/");
      }}
    >
      <div className="mx-auto flex max-w-xl flex-col gap-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

        <section className="flex flex-col gap-4 rounded-xl border border-surface-border bg-surface-raised p-5">
          <h2 className="text-sm font-semibold">Profile</h2>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Display name</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="input" />
          </label>
          <div className="grid grid-cols-2 gap-4 text-xs text-ink-muted">
            <div>
              <p className="uppercase tracking-wide">Username</p>
              <p className="mt-1 text-ink-2">@{user.username}</p>
            </div>
            <div>
              <p className="uppercase tracking-wide">Email</p>
              <p className="mt-1 text-ink-2">{user.email}</p>
            </div>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="self-start rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {saved && <span className="text-xs text-success">Saved</span>}
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-surface-border bg-surface-raised p-5">
          <h2 className="text-sm font-semibold">Active sessions</h2>
          {sessions === null && <p className="text-xs text-ink-muted">Loading…</p>}
          {sessions?.length === 0 && <p className="text-xs text-ink-muted">No other active sessions.</p>}
          <ul className="flex flex-col gap-2">
            {sessions?.map((s) => (
              <li key={s.id} className="rounded-lg border border-surface-border px-3 py-2.5 text-xs">
                <p className="text-ink-2">{s.userAgent ?? "Unknown device"}</p>
                <p className="mt-0.5 text-ink-muted">
                  {s.ip ?? "Unknown IP"} · last used {new Date(s.lastUsedAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <button
          onClick={() => {
            clear();
            router.push("/");
          }}
          className="self-start rounded-lg bg-surface-chip px-4 py-2 text-sm font-medium text-ink-3 hover:brightness-110"
        >
          Sign out
        </button>
      </div>
    </AppShell>
  );
}
