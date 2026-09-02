"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, usePathname } from "next/navigation";
import { loginRedirectUrl } from "@/lib/login-redirect";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { AppShell } from "@/components/layout/app-shell";
import { FullPageLoading } from "@/components/full-page-loading";

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  plan: string;
  storageLimitBytes: string;
  meetingConcurrencyLimit: number;
  logoUrl: string | null;
  brandColor: string | null;
  joinPageMessage: string | null;
}

interface Member {
  userId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  joinedAt: string;
  user: { id: string; displayName: string; username: string; email: string; avatarUrl: string | null };
}

interface Invite {
  id: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  status: string;
  expiresAt: string;
  createdAt: string;
}

interface Team {
  id: string;
  name: string;
  description: string | null;
  _count: { members: number };
}

function formatBytes(s: string) {
  const gb = Number(s) / 1024 / 1024 / 1024;
  return `${gb.toFixed(1)} GB`;
}

/** Real member-management UI — distinct from the read-only admin dashboard,
 * this is what an org owner/admin actually uses day to day: invite by
 * email, see who's pending, change roles, remove people. */
export default function OrganizationDetailPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id: string }>();
  const orgId = params.id;
  const { user, accessToken, clear, hasHydrated } = useAuthStore();

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSent, setInviteSent] = useState<string | null>(null);

  const [teams, setTeams] = useState<Team[] | null>(null);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamBusy, setTeamBusy] = useState(false);

  const [logoUrlDraft, setLogoUrlDraft] = useState("");
  const [brandColorDraft, setBrandColorDraft] = useState("#3B6FE0");
  const [messageDraft, setMessageDraft] = useState("");
  const [brandingBusy, setBrandingBusy] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [brandingSaved, setBrandingSaved] = useState(false);

  const me = members?.find((m) => m.userId === user?.id);
  const isOwner = me?.role === "OWNER";
  const isManager = me?.role === "OWNER" || me?.role === "ADMIN";

  function refresh() {
    return Promise.all([
      apiFetch<OrgDetail>(`/organizations/${orgId}`).then((o) => {
        setOrg(o);
        setLogoUrlDraft(o.logoUrl ?? "");
        setBrandColorDraft(o.brandColor ?? "#3B6FE0");
        setMessageDraft(o.joinPageMessage ?? "");
      }),
      apiFetch<Member[]>(`/organizations/${orgId}/members`).then(setMembers),
    ]).catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load organization"));
  }

  function refreshInvites() {
    return apiFetch<Invite[]>(`/organizations/${orgId}/invites`)
      .then(setInvites)
      .catch(() => setInvites([]));
  }

  function refreshTeams() {
    return apiFetch<Team[]>(`/organizations/${orgId}/teams`)
      .then(setTeams)
      .catch(() => setTeams([]));
  }

  useEffect(() => {
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace(loginRedirectUrl(pathname));
      return;
    }
    refresh();
    refreshTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, accessToken, orgId]);

  useEffect(() => {
    if (isManager) refreshInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager]);

  async function sendInvite() {
    if (!inviteEmail.trim()) return;
    setInviteBusy(true);
    setInviteError(null);
    setInviteSent(null);
    try {
      await apiFetch(`/organizations/${orgId}/invites`, {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setInviteSent(inviteEmail.trim());
      setInviteEmail("");
      await refreshInvites();
    } catch (err) {
      setInviteError(err instanceof ApiError ? err.message : "Failed to send invite");
    } finally {
      setInviteBusy(false);
    }
  }

  async function revokeInvite(inviteId: string) {
    setBusy(`invite-${inviteId}`);
    try {
      await apiFetch(`/organizations/${orgId}/invites/${inviteId}`, { method: "DELETE" });
      await refreshInvites();
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(userId: string) {
    setBusy(`remove-${userId}`);
    setError(null);
    try {
      await apiFetch(`/organizations/${orgId}/members/${userId}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove member");
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(userId: string, role: "OWNER" | "ADMIN" | "MEMBER") {
    setBusy(`role-${userId}`);
    setError(null);
    try {
      await apiFetch(`/organizations/${orgId}/members/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to change role");
    } finally {
      setBusy(null);
    }
  }

  async function leave() {
    setBusy("leave");
    setError(null);
    try {
      await apiFetch(`/organizations/${orgId}/leave`, { method: "POST" });
      router.push("/organizations");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to leave organization");
      setBusy(null);
    }
  }

  async function saveBranding() {
    setBrandingBusy(true);
    setBrandingError(null);
    setBrandingSaved(false);
    try {
      await apiFetch(`/organizations/${orgId}/branding`, {
        method: "PATCH",
        body: JSON.stringify({
          logoUrl: logoUrlDraft.trim() || null,
          brandColor: brandColorDraft || null,
          joinPageMessage: messageDraft.trim() || null,
        }),
      });
      setBrandingSaved(true);
      await refresh();
    } catch (err) {
      setBrandingError(err instanceof ApiError ? err.message : "Failed to save branding");
    } finally {
      setBrandingBusy(false);
    }
  }

  async function createTeam() {
    if (!newTeamName.trim()) return;
    setTeamBusy(true);
    setTeamError(null);
    try {
      const team = await apiFetch<Team>(`/organizations/${orgId}/teams`, {
        method: "POST",
        body: JSON.stringify({ name: newTeamName.trim() }),
      });
      setCreatingTeam(false);
      setNewTeamName("");
      router.push(`/teams/${team.id}`);
    } catch (err) {
      setTeamError(err instanceof ApiError ? err.message : "Failed to create team");
    } finally {
      setTeamBusy(false);
    }
  }

  if (!user) return <FullPageLoading />;

  return (
    <AppShell
      user={user}
      active="organizations"
      accessToken={accessToken}
      onSignOut={() => {
        clear();
        router.push("/");
      }}
    >
      <div className="flex flex-col gap-6">
        <button onClick={() => router.push("/organizations")} className="self-start text-xs text-ink-muted hover:text-white">
          ← Organizations
        </button>

        {!org && <p className="text-sm text-ink-muted">Loading…</p>}
        {error && <p className="text-sm text-danger">{error}</p>}

        {org && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
                <p className="mt-1 text-[13px] text-ink-muted">
                  @{org.slug} · {org.plan} · up to {org.meetingConcurrencyLimit} concurrent meetings · {formatBytes(org.storageLimitBytes)} storage
                </p>
              </div>
              <button
                onClick={leave}
                disabled={busy === "leave"}
                className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-ink-3 hover:brightness-110 disabled:opacity-50"
              >
                {busy === "leave" ? "Leaving…" : "Leave organization"}
              </button>
            </div>

            {isManager && (
              <div className="rounded-xl border border-surface-border bg-surface-raised p-4">
                <h2 className="mb-3 text-sm font-semibold">Invite by email</h2>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-1 flex-col gap-1.5" style={{ minWidth: 220 }}>
                    <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Email</span>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="teammate@example.com"
                      className="input"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Role</span>
                    <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "ADMIN" | "MEMBER")} className="input">
                      <option value="MEMBER">Member</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </label>
                  <button
                    onClick={sendInvite}
                    disabled={inviteBusy || !inviteEmail.trim()}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {inviteBusy ? "Sending…" : "Send invite"}
                  </button>
                </div>
                {inviteError && <p className="mt-2 text-xs text-danger">{inviteError}</p>}
                {inviteSent && <p className="mt-2 text-xs text-success">A real invite email was sent to {inviteSent}.</p>}

                {invites && invites.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">Pending invites</p>
                    <ul className="flex flex-col gap-1.5">
                      {invites.map((inv) => (
                        <li key={inv.id} className="flex items-center justify-between rounded-lg bg-surface-field px-3 py-1.5 text-xs">
                          <span className="text-ink-2">
                            {inv.email} <span className="text-ink-muted">· {inv.role.toLowerCase()}</span>
                          </span>
                          <button
                            onClick={() => revokeInvite(inv.id)}
                            disabled={busy === `invite-${inv.id}`}
                            className="text-ink-muted hover:text-danger disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {isManager && (
              <div className="rounded-xl border border-surface-border bg-surface-raised p-4">
                <h2 className="mb-1 text-sm font-semibold">Branding</h2>
                <p className="mb-3 text-xs text-ink-muted">
                  Shown to guests on this org&apos;s meeting join screens — logo, accent color, and a short welcome
                  message.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-1 flex-col gap-1.5" style={{ minWidth: 240 }}>
                    <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Logo URL</span>
                    <input
                      value={logoUrlDraft}
                      onChange={(e) => setLogoUrlDraft(e.target.value)}
                      placeholder="https://example.com/logo.png"
                      className="input"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Brand color</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label="Brand color picker"
                        value={brandColorDraft}
                        onChange={(e) => setBrandColorDraft(e.target.value)}
                        className="h-[38px] w-10 cursor-pointer rounded border border-surface-border bg-surface-field p-0.5"
                      />
                      <input
                        value={brandColorDraft}
                        onChange={(e) => setBrandColorDraft(e.target.value)}
                        placeholder="#3B6FE0"
                        className="input w-28"
                      />
                    </div>
                  </label>
                </div>
                <label className="mt-3 flex flex-col gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Join page message
                  </span>
                  <textarea
                    value={messageDraft}
                    onChange={(e) => setMessageDraft(e.target.value)}
                    rows={2}
                    maxLength={280}
                    placeholder="Welcome — please join a minute early so we can get started on time."
                    className="input"
                  />
                </label>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={saveBranding}
                    disabled={brandingBusy}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {brandingBusy ? "Saving…" : "Save branding"}
                  </button>
                  <span
                    data-testid="branding-preview-button"
                    style={{ backgroundColor: brandColorDraft || undefined }}
                    className="rounded-lg px-4 py-2 text-xs font-medium text-white"
                  >
                    Preview: Join meeting
                  </span>
                  {brandingSaved && <span className="text-xs text-success">Saved.</span>}
                  {brandingError && <span className="text-xs text-danger">{brandingError}</span>}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Teams ({teams?.length ?? 0})</h2>
                <button onClick={() => setCreatingTeam(true)} className="text-xs font-medium text-brand-300 hover:underline">
                  + New team
                </button>
              </div>
              {creatingTeam && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-surface-border bg-surface-raised p-3">
                  <input
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    placeholder="e.g. Engineering"
                    className="input flex-1"
                    autoFocus
                  />
                  <button
                    onClick={createTeam}
                    disabled={teamBusy || !newTeamName.trim()}
                    className="rounded-lg bg-brand-500 px-3 py-2 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {teamBusy ? "Creating…" : "Create"}
                  </button>
                  <button onClick={() => setCreatingTeam(false)} className="text-xs text-ink-muted hover:text-white">
                    Cancel
                  </button>
                </div>
              )}
              {teamError && <p className="mb-2 text-xs text-danger">{teamError}</p>}
              {teams?.length === 0 && !creatingTeam && (
                <p className="mb-4 text-xs text-ink-muted">No teams yet — create one to give a sub-group its own chat and meetings.</p>
              )}
              {teams && teams.length > 0 && (
                <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {teams.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => router.push(`/teams/${t.id}`)}
                      className="rounded-lg border border-surface-border bg-surface-field px-3 py-2 text-left text-xs hover:border-brand-500"
                    >
                      <p className="font-medium text-ink-2">{t.name}</p>
                      <p className="text-ink-muted">{t._count.members} member{t._count.members === 1 ? "" : "s"}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h2 className="mb-2 text-sm font-semibold">Members ({members?.length ?? 0})</h2>
              <ul className="flex flex-col gap-1.5">
                {members?.map((m) => (
                  <li key={m.userId} className="flex items-center justify-between rounded-lg bg-surface-field px-3 py-2 text-xs">
                    <span className="flex items-center gap-2 text-ink-2">
                      {m.user.displayName}
                      <span className="text-ink-muted">@{m.user.username}</span>
                      {m.userId === user.id && <span className="text-ink-muted">(you)</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      {isOwner ? (
                        <select
                          value={m.role}
                          onChange={(e) => changeRole(m.userId, e.target.value as "OWNER" | "ADMIN" | "MEMBER")}
                          disabled={busy === `role-${m.userId}`}
                          className="rounded-md bg-surface-chip px-1.5 py-1 text-[11px] text-ink-2"
                        >
                          <option value="OWNER">Owner</option>
                          <option value="ADMIN">Admin</option>
                          <option value="MEMBER">Member</option>
                        </select>
                      ) : (
                        <span className="rounded-full bg-brand-500/20 px-1.5 py-0.5 text-[10px] font-medium text-brand-300">
                          {m.role}
                        </span>
                      )}
                      {isManager && m.userId !== user.id && (
                        <button
                          onClick={() => removeMember(m.userId)}
                          disabled={busy === `remove-${m.userId}`}
                          className="text-ink-muted hover:text-danger disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
