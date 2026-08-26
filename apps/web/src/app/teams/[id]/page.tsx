"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { WS_EVENTS } from "@arutech/types";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { getSocket } from "@/lib/socket";
import { AppShell } from "@/components/layout/app-shell";
import { TeamChatPanel } from "@/components/teams/team-chat-panel";

interface TeamDetail {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  chatRoom: { id: string } | null;
}

interface TeamMemberRow {
  userId: string;
  role: "LEAD" | "MEMBER";
  user: { id: string; displayName: string; username: string; avatarUrl: string | null };
}

/** A Team's home — chat + meetings + membership, the same relationship
 * shape `ChatRoom`/`Meeting` already have to a `Class`. See
 * docs/roadmap.md's Teams stage for the full design (including why "Start a
 * meeting" needs no new backend endpoint at all — it's the identical
 * client-side pattern Stage 23 already shipped for Team Chat groups). */
export default function TeamDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const teamId = params.id;
  const { user, accessToken, clear, hasHydrated } = useAuthStore();

  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [members, setMembers] = useState<TeamMemberRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [startingMeeting, setStartingMeeting] = useState(false);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const me = members?.find((m) => m.userId === user?.id);
  const isMember = Boolean(me);
  const isLead = me?.role === "LEAD";

  function refresh() {
    return Promise.all([
      apiFetch<TeamDetail>(`/teams/${teamId}`).then((t) => {
        setTeam(t);
        setNameDraft(t.name);
      }),
      apiFetch<TeamMemberRow[]>(`/teams/${teamId}/members`).then(setMembers),
    ]).catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load team"));
  }

  useEffect(() => {
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, accessToken, teamId]);

  async function join() {
    setBusy("join");
    setError(null);
    try {
      await apiFetch(`/teams/${teamId}/join`, { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to join team");
    } finally {
      setBusy(null);
    }
  }

  async function leave() {
    setBusy("leave");
    setError(null);
    try {
      await apiFetch(`/teams/${teamId}/leave`, { method: "POST" });
      router.push(`/organizations/${team?.orgId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to leave team");
      setBusy(null);
    }
  }

  async function removeMember(userId: string) {
    setBusy(`remove-${userId}`);
    setError(null);
    try {
      await apiFetch(`/teams/${teamId}/members/${userId}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove member");
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(userId: string, role: "LEAD" | "MEMBER") {
    setBusy(`role-${userId}`);
    setError(null);
    try {
      await apiFetch(`/teams/${teamId}/members/${userId}/role`, {
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

  async function saveName() {
    if (!nameDraft.trim()) return;
    setBusy("rename");
    try {
      await apiFetch(`/teams/${teamId}`, { method: "PATCH", body: JSON.stringify({ name: nameDraft.trim() }) });
      setEditingName(false);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function deleteTeam() {
    setBusy("delete");
    try {
      await apiFetch(`/teams/${teamId}`, { method: "DELETE" });
      router.push(`/organizations/${team?.orgId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete team");
      setBusy(null);
    }
  }

  // Identical client-side pattern Stage 23 shipped for Team Chat groups — a
  // real instant Meeting, its join link posted as a real chat message. No
  // new backend endpoint for this at all.
  async function startMeeting() {
    if (!team || !accessToken) return;
    setStartingMeeting(true);
    try {
      const meeting = await apiFetch<{ code: string }>("/meetings", {
        method: "POST",
        body: JSON.stringify({ title: `${team.name} meeting`, type: "INSTANT", timezone: "UTC", orgId: team.orgId }),
      });
      const link = `${window.location.origin}/meeting/${meeting.code}`;
      getSocket(accessToken).emit(WS_EVENTS.ROOM_MESSAGE, {
        chatRoomId: team.chatRoom!.id,
        body: `📹 Starting a meeting — join here: ${link}`,
      });
      router.push(`/meeting/${meeting.code}`);
    } finally {
      setStartingMeeting(false);
    }
  }

  if (!user) return null;

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
      <div className="flex h-[calc(100vh-140px)] flex-col gap-4">
        {team && (
          <button
            onClick={() => router.push(`/organizations/${team.orgId}`)}
            className="self-start text-xs text-ink-muted hover:text-white"
          >
            ← Organization
          </button>
        )}

        {!team && <p className="text-sm text-ink-muted">Loading…</p>}
        {error && <p className="text-sm text-danger">{error}</p>}

        {team && (
          <>
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                {editingName ? (
                  <div className="flex items-center gap-2">
                    <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className="input" autoFocus />
                    <button onClick={saveName} disabled={busy === "rename"} className="text-xs text-brand-300 hover:underline">
                      Save
                    </button>
                    <button onClick={() => setEditingName(false)} className="text-xs text-ink-muted hover:text-white">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <h1 className="truncate text-2xl font-semibold tracking-tight">
                    {team.name}
                    {isLead && (
                      <button
                        onClick={() => setEditingName(true)}
                        aria-label="Rename team"
                        className="ml-2 align-middle text-xs text-ink-muted hover:text-white"
                      >
                        Rename
                      </button>
                    )}
                  </h1>
                )}
                <p className="mt-1 text-[13px] text-ink-muted">{members?.length ?? 0} members</p>
              </div>
              <div className="flex flex-none items-center gap-2">
                {isMember && (
                  <button
                    onClick={startMeeting}
                    disabled={startingMeeting}
                    className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-ink-3 hover:brightness-110 disabled:opacity-50"
                  >
                    {startingMeeting ? "Starting…" : "Start a meeting"}
                  </button>
                )}
                {!isMember ? (
                  <button
                    onClick={join}
                    disabled={busy === "join"}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {busy === "join" ? "Joining…" : "Join team"}
                  </button>
                ) : (
                  <button
                    onClick={leave}
                    disabled={busy === "leave"}
                    className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-ink-3 hover:brightness-110 disabled:opacity-50"
                  >
                    {busy === "leave" ? "Leaving…" : "Leave team"}
                  </button>
                )}
                {isLead && (
                  <button
                    onClick={deleteTeam}
                    disabled={busy === "delete"}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
                  >
                    Delete team
                  </button>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 gap-4">
              <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-surface-border bg-surface-raised">
                {isMember && team.chatRoom ? (
                  <TeamChatPanel chatRoomId={team.chatRoom.id} />
                ) : (
                  <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-ink-muted">
                    Join this team to see and send messages.
                  </div>
                )}
              </div>

              <div className="w-[260px] flex-none overflow-y-auto rounded-xl border border-surface-border bg-surface-raised p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">Members</p>
                <ul aria-label="Team members" className="flex flex-col gap-1.5">
                  {members?.map((m) => (
                    <li key={m.userId} className="flex items-center justify-between rounded-lg bg-surface-field px-2.5 py-1.5 text-xs">
                      <span className="truncate text-ink-2">
                        {m.user.displayName}
                        {m.userId === user.id && <span className="text-ink-muted"> (you)</span>}
                      </span>
                      <span className="flex flex-none items-center gap-1.5">
                        <span className="rounded-full bg-brand-500/20 px-1.5 py-0.5 text-[9px] font-medium text-brand-300">
                          {m.role}
                        </span>
                        {isLead && m.userId !== user.id && (
                          <>
                            <button
                              onClick={() => changeRole(m.userId, m.role === "LEAD" ? "MEMBER" : "LEAD")}
                              disabled={busy === `role-${m.userId}`}
                              className="text-[10px] text-brand-300 hover:underline disabled:opacity-50"
                            >
                              {m.role === "LEAD" ? "Demote" : "Make lead"}
                            </button>
                            <button
                              onClick={() => removeMember(m.userId)}
                              disabled={busy === `remove-${m.userId}`}
                              className="text-[10px] text-danger hover:underline disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
