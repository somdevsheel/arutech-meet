"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { loginRedirectUrl } from "@/lib/login-redirect";
import { changePasswordSchema } from "@arutech/validation";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/layout/app-shell";
import { FullPageLoading } from "@/components/full-page-loading";
import { Avatar } from "@/components/avatar";

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
  const pathname = usePathname();
  const { user, accessToken, clear, hasHydrated, setSession } = useAuthStore();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  // L-1: Active Sessions used to be purely read-only — no way to sign out
  // any device but the one you're currently using.
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // M-2: Settings' "Change password" section — separate state/flow from the
  // profile form above since it hits a different endpoint (auth/change-
  // password, which needs the current password) and, on success, signs the
  // user out everywhere rather than just re-syncing the session store.
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace(loginRedirectUrl(pathname));
      return;
    }
    if (user) {
      setDisplayName(user.displayName);
      setAvatarUrl(user.avatarUrl ?? "");
    }
    apiFetch<Session[]>("/users/me/sessions")
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [hasHydrated, accessToken, user, router, pathname]);

  async function save() {
    if (!user || !accessToken) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await apiFetch<typeof user>("/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          displayName,
          // Same reasoning as GroupSettingsModal's photoUrl field: this form
          // always reflects a definite value (the existing avatar or
          // cleared to empty), so an empty field always means "remove the
          // avatar", which only an explicit `null` can express — omitting
          // the field would mean "leave it as it is" instead.
          avatarUrl: avatarUrl.trim() || null,
        }),
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

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);

    if (newPassword !== confirmPassword) {
      setPwError("New passwords don't match");
      return;
    }
    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setPwError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    setPwSaving(true);
    try {
      await apiFetch("/auth/change-password", { method: "POST", body: JSON.stringify(parsed.data) });
      setPwDone(true);
      // The API just revoked every session for this user, including this
      // one — sign out client-side immediately rather than let the next
      // silent refresh attempt fail and surface as a confusing bounce.
      setTimeout(() => {
        clear();
        router.push("/login");
      }, 2000);
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : "Failed to change password");
    } finally {
      setPwSaving(false);
    }
  }

  async function revokeSession(sessionId: string) {
    setRevokingId(sessionId);
    setRevokeError(null);
    try {
      await apiFetch(`/users/me/sessions/${sessionId}`, { method: "DELETE" });
      setSessions((prev) => prev?.filter((s) => s.id !== sessionId) ?? prev);
    } catch (err) {
      setRevokeError(err instanceof ApiError ? err.message : "Failed to sign out that device");
    } finally {
      setRevokingId(null);
    }
  }

  if (!user) return <FullPageLoading />;

  return (
    <AppShell
      user={user}
      active="settings"
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
          <div className="flex items-center gap-4">
            <Avatar name={displayName || user.displayName} avatarUrl={avatarUrl} size={56} />
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-ink-muted">
                Avatar URL (optional)
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl("")}
                    className="text-[10px] font-medium normal-case tracking-normal text-danger hover:underline"
                  >
                    Remove avatar
                  </button>
                )}
              </span>
              <input
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://…"
                className="input"
              />
            </label>
          </div>
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

        <section className="flex flex-col gap-4 rounded-xl border border-surface-border bg-surface-raised p-5">
          <h2 className="text-sm font-semibold">Change password</h2>
          {pwDone ? (
            <p className="text-sm text-success">
              Password changed. You&apos;ve been signed out everywhere — taking you to sign in…
            </p>
          ) : (
            <form onSubmit={changePassword} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                  Current password
                </span>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="input"
                  required
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                  New password
                </span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input"
                  required
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                  Confirm new password
                </span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input"
                  required
                />
              </label>
              {pwError && <p className="text-sm text-danger">{pwError}</p>}
              <button
                type="submit"
                disabled={pwSaving}
                className="self-start rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {pwSaving ? "Changing…" : "Change password"}
              </button>
            </form>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-surface-border bg-surface-raised p-5">
          <h2 className="text-sm font-semibold">Active sessions</h2>
          {sessions === null && <p className="text-xs text-ink-muted">Loading…</p>}
          {sessions?.length === 0 && <p className="text-xs text-ink-muted">No other active sessions.</p>}
          {revokeError && <p className="text-xs text-danger">{revokeError}</p>}
          <ul className="flex flex-col gap-2">
            {sessions?.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-surface-border px-3 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-ink-2">
                    {s.userAgent ?? "Unknown device"}
                    {s.current && (
                      <span className="rounded-full bg-brand-500/20 px-1.5 py-0.5 text-[10px] font-medium text-brand-300">
                        This device
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-ink-muted">
                    {s.ip ?? "Unknown IP"} · last used {new Date(s.lastUsedAt).toLocaleString()}
                  </p>
                </div>
                {!s.current && (
                  <button
                    onClick={() => revokeSession(s.id)}
                    disabled={revokingId === s.id}
                    className="flex-none rounded-lg px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                  >
                    {revokingId === s.id ? "Signing out…" : "Sign out"}
                  </button>
                )}
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
