"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WS_EVENTS, type ChatMessagePayload, type UserPresenceStatus, type UserPresenceUpdatedPayload } from "@arutech/types";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { getSocket } from "@/lib/socket";
import { AppShell } from "@/components/layout/app-shell";
import { NewRoomModal } from "@/components/chat/new-room-modal";
import { GroupSettingsModal } from "@/components/chat/group-settings-modal";
import { ChatAttachmentView } from "@/components/chat/chat-attachment-view";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { formatLastSeen, formatLastSeenPhrase } from "@/lib/format-last-seen";
import { PRESENCE_STATUS_META } from "@/lib/presence";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const TYPING_STOP_DELAY_MS = 2500;

interface RoomMember {
  user: { id: string; displayName: string; username: string; avatarUrl: string | null; lastSeenAt: string };
  lastReadMessageId: string | null;
  userId: string;
  isAdmin: boolean;
}

interface RoomSummary {
  id: string;
  type: "GROUP" | "DIRECT" | "MEETING" | "CLASS";
  name: string | null;
  photoUrl: string | null;
  members: RoomMember[];
  messages: { id: string; body: string | null; createdAt: string }[];
}

function initialsOf(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

function roomTitle(room: RoomSummary, myUserId: string) {
  if (room.type === "GROUP") return room.name || "Group chat";
  const other = room.members.find((m) => m.userId !== myUserId);
  return other?.user.displayName ?? "Direct message";
}

function renderBody(text: string) {
  const tokenPattern = /(https?:\/\/[^\s]+)|(@[a-zA-Z0-9_]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = tokenPattern.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const [full, url, mention] = match;
    if (url) {
      parts.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="text-brand-300 underline">
          {url}
        </a>,
      );
    } else if (mention) {
      parts.push(
        <span key={key++} className="font-medium text-brand-300">
          {mention}
        </span>,
      );
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

async function uploadRoomAttachment(chatRoomId: string, file: File): Promise<string> {
  const { fileId, uploadUrl } = await apiFetch<{ fileId: string; uploadUrl: string }>(
    `/chat-rooms/${chatRoomId}/files/presign`,
    { method: "POST", body: JSON.stringify({ fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size }) },
  );
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!uploadRes.ok) throw new Error(`Upload failed (${uploadRes.status})`);
  return fileId;
}

function TeamChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, accessToken, clear, hasHydrated } = useAuthStore();
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("room"));
  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const [draft, setDraft] = useState("");
  const [showNewRoom, setShowNewRoom] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [startingMeeting, setStartingMeeting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [forwardingId, setForwardingId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [typingUserIds, setTypingUserIds] = useState<Set<string>>(new Set());
  const [presenceByUserId, setPresenceByUserId] = useState<Record<string, UserPresenceStatus>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasTypingRef = useRef(false);
  const voice = useVoiceRecorder();

  const selected = rooms?.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    if (!hasHydrated) return;
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    apiFetch<RoomSummary[]>("/chat-rooms").then((data) => {
      setRooms(data);
      if (!selectedId && data[0]) setSelectedId(data[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, accessToken]);

  // Real presence (docs/roadmap.md's Presence stage) — an initial bulk fetch
  // for every member across every room in the list (covers rooms that aren't
  // currently open, which never receive a live PRESENCE_UPDATED push — see
  // that event's own doc comment on RealtimeGateway.broadcastPresence), then
  // kept live for whichever room actually is open via the listener below.
  useEffect(() => {
    if (!rooms || rooms.length === 0) return;
    const ids = [...new Set(rooms.flatMap((r) => r.members.map((m) => m.userId)).filter((id) => id !== user?.id))];
    if (ids.length === 0) return;
    apiFetch<Record<string, UserPresenceStatus>>(`/presence?userIds=${encodeURIComponent(ids.join(","))}`)
      .then((statuses) => setPresenceByUserId((prev) => ({ ...prev, ...statuses })))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms]);

  // Live presence updates — only ever arrive for a room this socket currently
  // has open (ROOM_JOIN'd), same reach limitation ROOM_UPDATED has.
  useEffect(() => {
    if (!accessToken) return;
    const socket = getSocket(accessToken);
    const onPresenceUpdated = (payload: UserPresenceUpdatedPayload) => {
      setPresenceByUserId((prev) => ({ ...prev, [payload.userId]: payload.status }));
    };
    socket.on(WS_EVENTS.PRESENCE_UPDATED, onPresenceUpdated);
    return () => {
      socket.off(WS_EVENTS.PRESENCE_UPDATED, onPresenceUpdated);
    };
  }, [accessToken]);

  // Join the selected room's realtime channel, load history, and mark it read.
  useEffect(() => {
    if (!selectedId || !accessToken) return;
    const socket = getSocket(accessToken);
    socket.emit(WS_EVENTS.ROOM_JOIN, { chatRoomId: selectedId });
    // roomHistory now returns the exact same shaped ChatMessagePayload[] meeting
    // chat uses (reactions/attachment/edit/forward fields included) — no more
    // manual reshaping needed here.
    apiFetch<ChatMessagePayload[]>(`/chat-rooms/${selectedId}/messages`).then((history) => {
      setMessages([...history].reverse());
    });
    apiFetch(`/chat-rooms/${selectedId}/read`, { method: "POST" }).catch(() => {});
    setTypingUserIds(new Set());

    return () => {
      socket.emit(WS_EVENTS.ROOM_LEAVE, { chatRoomId: selectedId });
    };
  }, [selectedId, accessToken]);

  // Live incoming messages for the open room; refresh the room list's preview
  // for any room (open or not) so previews/ordering stay current.
  useEffect(() => {
    if (!accessToken) return;
    const socket = getSocket(accessToken);
    const onMessage = (payload: ChatMessagePayload) => {
      if (payload.chatRoomId === selectedId) {
        setMessages((prev) => (prev.some((m) => m.id === payload.id) ? prev : [...prev, payload]));
      }
      setRooms((prev) => {
        if (!prev) return prev;
        const known = prev.some((r) => r.id === payload.chatRoomId);
        if (!known) {
          // First message of a conversation someone else just started with us
          // (e.g. Alice clicked "Message" on Contacts) — this room doesn't
          // exist in our list yet, so patching it in-place would silently
          // no-op. Re-fetch the room list instead of guessing its shape.
          apiFetch<RoomSummary[]>("/chat-rooms").then(setRooms);
          return prev;
        }
        return prev
          .map((r) =>
            r.id === payload.chatRoomId
              ? { ...r, messages: [{ id: payload.id, body: payload.body, createdAt: payload.createdAt }] }
              : r,
          )
          .sort((a, b) => {
            const at = a.messages[0]?.createdAt ?? "";
            const bt = b.messages[0]?.createdAt ?? "";
            return at < bt ? 1 : -1;
          });
      });
    };
    const onEdited = (updated: ChatMessagePayload) =>
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    const onDeleted = (p: { messageId: string }) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === p.messageId ? { ...m, body: null, deletedAt: new Date().toISOString() } : m)),
      );
    socket.on(WS_EVENTS.ROOM_MESSAGE, onMessage);
    socket.on(WS_EVENTS.ROOM_MESSAGE_EDITED, onEdited);
    socket.on(WS_EVENTS.ROOM_MESSAGE_DELETED, onDeleted);
    return () => {
      socket.off(WS_EVENTS.ROOM_MESSAGE, onMessage);
      socket.off(WS_EVENTS.ROOM_MESSAGE_EDITED, onEdited);
      socket.off(WS_EVENTS.ROOM_MESSAGE_DELETED, onDeleted);
    };
  }, [accessToken, selectedId]);

  // Group details/membership/admin changes made by anyone (including from a
  // different tab/device) — re-fetch rather than push the full new state,
  // see WS_EVENTS.ROOM_UPDATED's own doc comment.
  useEffect(() => {
    if (!accessToken) return;
    const socket = getSocket(accessToken);
    const onRoomUpdated = () => {
      apiFetch<RoomSummary[]>("/chat-rooms").then(setRooms);
    };
    socket.on(WS_EVENTS.ROOM_UPDATED, onRoomUpdated);
    return () => {
      socket.off(WS_EVENTS.ROOM_UPDATED, onRoomUpdated);
    };
  }, [accessToken]);

  // Typing indicator for the currently-open room only.
  useEffect(() => {
    if (!accessToken || !selectedId) return;
    const socket = getSocket(accessToken);
    const onTyping = (p: { userId: string; isTyping: boolean }) => {
      if (p.userId === user?.id) return;
      setTypingUserIds((prev) => {
        const next = new Set(prev);
        if (p.isTyping) next.add(p.userId);
        else next.delete(p.userId);
        return next;
      });
    };
    socket.on(WS_EVENTS.CHAT_TYPING, onTyping);
    return () => {
      socket.off(WS_EVENTS.CHAT_TYPING, onTyping);
    };
  }, [accessToken, selectedId, user?.id]);

  function handleDraftChange(value: string) {
    setDraft(value);
    if (!accessToken || !selectedId) return;
    const socket = getSocket(accessToken);
    if (value.trim() && !wasTypingRef.current) {
      wasTypingRef.current = true;
      socket.emit(WS_EVENTS.CHAT_TYPING, { chatRoomId: selectedId, isTyping: true });
    }
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = setTimeout(() => {
      wasTypingRef.current = false;
      socket.emit(WS_EVENTS.CHAT_TYPING, { chatRoomId: selectedId, isTyping: false });
    }, TYPING_STOP_DELAY_MS);
  }

  function stopTypingNow() {
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    if (wasTypingRef.current && accessToken && selectedId) {
      wasTypingRef.current = false;
      getSocket(accessToken).emit(WS_EVENTS.CHAT_TYPING, { chatRoomId: selectedId, isTyping: false });
    }
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !selectedId || !accessToken) return;
    stopTypingNow();
    getSocket(accessToken).emit(WS_EVENTS.ROOM_MESSAGE, { chatRoomId: selectedId, body });
    setDraft("");
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedId || !accessToken) return;
    setUploadError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(`${file.name} is too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`);
      return;
    }
    setUploading(true);
    try {
      const fileId = await uploadRoomAttachment(selectedId, file);
      getSocket(accessToken).emit(WS_EVENTS.ROOM_MESSAGE, { chatRoomId: selectedId, body: draft.trim() || undefined, fileId });
      setDraft("");
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function stopVoiceAndSend() {
    const file = await voice.stop();
    if (!file || !selectedId || !accessToken) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fileId = await uploadRoomAttachment(selectedId, file);
      getSocket(accessToken).emit(WS_EVENTS.ROOM_MESSAGE, { chatRoomId: selectedId, fileId });
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to send voice message");
    } finally {
      setUploading(false);
    }
  }

  async function editMessage(messageId: string, body: string) {
    if (!selectedId) return;
    await apiFetch(`/chat-rooms/${selectedId}/messages/${messageId}`, { method: "PATCH", body: JSON.stringify({ body }) });
    setEditingId(null);
  }

  async function deleteMessage(messageId: string) {
    if (!selectedId) return;
    await apiFetch(`/chat-rooms/${selectedId}/messages/${messageId}`, { method: "DELETE" });
  }

  async function leaveRoom(roomId: string) {
    await apiFetch(`/chat-rooms/${roomId}/leave`, { method: "POST" });
    setRooms((prev) => prev?.filter((r) => r.id !== roomId) ?? null);
    if (selectedId === roomId) setSelectedId(null);
  }

  /** "Group call/meeting shortcut" — starts a real instant meeting (already
   * fully N-person capable, unlike Calls which is still 1:1-UI-only per
   * docs/roadmap.md Stage 15) and posts the join link into the group chat, so
   * every member sees it the moment it's created — reuses the existing
   * meeting engine and chat message pipeline rather than building a second,
   * genuinely new group-calling UI (that's its own separate, larger,
   * not-yet-built item). */
  async function startGroupMeeting() {
    if (!selectedId || !accessToken) return;
    setStartingMeeting(true);
    try {
      const meeting = await apiFetch<{ code: string }>("/meetings", {
        method: "POST",
        body: JSON.stringify({ title: roomTitle(selected!, user!.id), type: "INSTANT" }),
      });
      const link = `${window.location.origin}/meeting/${meeting.code}`;
      getSocket(accessToken).emit(WS_EVENTS.ROOM_MESSAGE, {
        chatRoomId: selectedId,
        body: `📹 Starting a meeting — join here: ${link}`,
      });
      router.push(`/meeting/${meeting.code}`);
    } finally {
      setStartingMeeting(false);
    }
  }

  if (!user) return null;

  const otherMember = selected?.type === "DIRECT" ? selected.members.find((m) => m.userId !== user.id) : null;

  return (
    <AppShell
      user={user}
      active="chat"
      accessToken={accessToken}
      onSignOut={() => {
        clear();
        router.push("/");
      }}
    >
      <div className="flex h-full min-h-0 gap-4">
        <div className="flex w-72 flex-none flex-col gap-2 overflow-y-auto">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight">Team Chat</h1>
            <button
              onClick={() => setShowNewRoom(true)}
              aria-label="New chat"
              className="grid h-8 w-8 place-items-center rounded-lg bg-surface-chip text-ink-3 hover:brightness-110"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>

          {rooms?.length === 0 && (
            <p className="mt-4 text-xs text-ink-muted">No conversations yet — start one.</p>
          )}
          <ul className="flex flex-col gap-1">
            {rooms?.map((room) => {
              const mine = room.members.find((m) => m.userId === user.id);
              const latest = room.messages[0];
              const unread = Boolean(latest && mine && mine.lastReadMessageId !== latest.id);
              const other = room.type === "DIRECT" ? room.members.find((m) => m.userId !== user.id) : null;
              const otherPresence = other ? presenceByUserId[other.userId] : undefined;
              return (
                <li key={room.id}>
                  <button
                    onClick={() => setSelectedId(room.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                      selectedId === room.id ? "bg-brand-tint2" : "hover:bg-surface-elevated"
                    }`}
                  >
                    <span className="relative flex-none">
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-500 text-[10px] font-semibold text-white">
                        {initialsOf(roomTitle(room, user.id))}
                      </span>
                      {otherPresence && otherPresence !== "OFFLINE" && (
                        <span
                          title={PRESENCE_STATUS_META[otherPresence].label}
                          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${PRESENCE_STATUS_META[otherPresence].dotClass}`}
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={`truncate text-sm ${unread ? "font-semibold text-white" : "font-medium text-ink-2"}`}>
                          {roomTitle(room, user.id)}
                        </span>
                        {unread && <span className="h-2 w-2 flex-none rounded-full bg-brand-500" />}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">
                        {latest?.body ?? "No messages yet"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-surface-border bg-surface-raised">
          {selected ? (
            <>
              <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-white">{roomTitle(selected, user.id)}</p>
                  {selected.type === "GROUP" && (
                    <p className="text-xs text-ink-muted">{selected.members.length} members</p>
                  )}
                  {otherMember && (
                    <p className="text-xs text-ink-muted">
                      {(() => {
                        const status = presenceByUserId[otherMember.userId];
                        if (status && status !== "OFFLINE") return PRESENCE_STATUS_META[status].label;
                        if (status === "OFFLINE") return formatLastSeenPhrase(otherMember.user.lastSeenAt);
                        return formatLastSeen(otherMember.user.lastSeenAt);
                      })()}
                    </p>
                  )}
                </div>
                {selected.type === "GROUP" && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={startGroupMeeting}
                      disabled={startingMeeting}
                      className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-ink-3 hover:brightness-110 disabled:opacity-50"
                    >
                      {startingMeeting ? "Starting…" : "Start a meeting"}
                    </button>
                    <button
                      onClick={() => setShowGroupSettings(true)}
                      className="rounded-lg bg-surface-chip px-3 py-1.5 text-xs font-medium text-ink-3 hover:brightness-110"
                    >
                      Manage
                    </button>
                    <button
                      onClick={() => leaveRoom(selected.id)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10"
                    >
                      Leave
                    </button>
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.length === 0 && <p className="text-xs text-ink-muted">No messages yet. Say hello 👋</p>}
                {messages.map((m) => (
                  <RoomChatMessage
                    key={m.id}
                    chatRoomId={selected.id}
                    message={m}
                    currentUserId={user.id}
                    isEditing={editingId === m.id}
                    isForwarding={forwardingId === m.id}
                    onStartEdit={() => setEditingId(m.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onSaveEdit={(body) => editMessage(m.id, body)}
                    onDelete={() => deleteMessage(m.id)}
                    onStartForward={() => setForwardingId((cur) => (cur === m.id ? null : m.id))}
                    onForwarded={() => setForwardingId(null)}
                  />
                ))}
                {typingUserIds.size > 0 && (
                  <p className="text-[11px] italic text-ink-muted">
                    {[...typingUserIds]
                      .map((id) => selected.members.find((m) => m.userId === id)?.user.displayName)
                      .filter(Boolean)
                      .join(", ")}{" "}
                    {typingUserIds.size === 1 ? "is" : "are"} typing…
                  </p>
                )}
              </div>

              {uploadError && <p className="px-3 text-xs text-danger">{uploadError}</p>}

              {voice.recording ? (
                <div className="flex items-center gap-2 border-t border-surface-border px-3 py-3">
                  <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-danger" />
                  <span className="flex-1 text-xs text-ink-2">
                    Recording… {String(Math.floor(voice.elapsed / 60)).padStart(2, "0")}:{String(voice.elapsed % 60).padStart(2, "0")}
                  </span>
                  <button onClick={() => voice.cancel()} className="text-xs text-ink-muted2 hover:text-white">
                    Cancel
                  </button>
                  <button
                    onClick={stopVoiceAndSend}
                    className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600"
                  >
                    Send
                  </button>
                </div>
              ) : (
                <form onSubmit={send} className="flex items-center gap-2 border-t border-surface-border p-3">
                  <input ref={fileInputRef} type="file" className="hidden" onChange={onFileSelected} />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    title="Attach a file"
                    aria-label="Attach a file"
                    className="flex-none text-ink-muted2 hover:text-white disabled:opacity-50"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 11.5V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6.5M17 14v6M14 17h6" />
                    </svg>
                  </button>
                  {voice.supported && (
                    <button
                      type="button"
                      onClick={() => voice.start()}
                      disabled={uploading}
                      title="Record a voice message"
                      aria-label="Record a voice message"
                      className="flex-none text-ink-muted2 hover:text-white disabled:opacity-50"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="2" width="6" height="12" rx="3" />
                        <path d="M5 10a7 7 0 0 0 14 0M12 19v3" />
                      </svg>
                    </button>
                  )}
                  <input
                    value={draft}
                    onChange={(e) => handleDraftChange(e.target.value)}
                    onBlur={stopTypingNow}
                    placeholder={uploading ? "Uploading…" : "Type a message…"}
                    className="input flex-1"
                    maxLength={4000}
                    disabled={uploading}
                  />
                  <button
                    type="submit"
                    disabled={uploading || !draft.trim()}
                    className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    Send
                  </button>
                </form>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-ink-muted">
              {rooms === null ? "Loading…" : "Select a conversation, or start a new one."}
            </div>
          )}
        </div>
      </div>

      {showNewRoom && (
        <NewRoomModal
          onClose={() => setShowNewRoom(false)}
          onCreated={(room) => {
            setRooms((prev) => {
              const withoutDup = (prev ?? []).filter((r) => r.id !== room.id);
              return [{ ...room, messages: [] }, ...withoutDup];
            });
            setSelectedId(room.id);
            setShowNewRoom(false);
          }}
        />
      )}

      {showGroupSettings && selected && (
        <GroupSettingsModal
          room={selected}
          currentUserId={user.id}
          onClose={() => setShowGroupSettings(false)}
          onUpdated={(updated) => {
            setRooms((prev) => prev?.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) ?? null);
          }}
        />
      )}
    </AppShell>
  );
}

function RoomChatMessage({
  chatRoomId,
  message,
  currentUserId,
  isEditing,
  isForwarding,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onStartForward,
  onForwarded,
}: {
  chatRoomId: string;
  message: ChatMessagePayload;
  currentUserId: string;
  isEditing: boolean;
  isForwarding: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (body: string) => Promise<void>;
  onDelete: () => void;
  onStartForward: () => void;
  onForwarded: () => void;
}) {
  const isDeleted = Boolean(message.deletedAt);
  const isMine = message.senderId === currentUserId;
  const [editDraft, setEditDraft] = useState(message.body ?? "");

  return (
    <div className="group">
      <div className="flex items-baseline gap-1.5">
        <b className="text-[11px] font-semibold text-ink-3">{isMine ? "You" : message.senderName}</b>
        <span className="text-[10px] text-ink-muted2">
          {new Date(message.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </span>
        {message.editedAt && <span className="text-[10px] text-ink-muted2">(edited)</span>}
      </div>

      {message.forwardedFromSenderName && !isDeleted && (
        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-muted2">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="m9 17 5-5-5-5M4 12h10" />
          </svg>
          Forwarded from {message.forwardedFromSenderName}
        </p>
      )}

      {isDeleted ? (
        <p className="mt-1 inline-block text-xs italic text-ink-muted">Message deleted</p>
      ) : isEditing ? (
        <div className="mt-1 flex max-w-[85%] flex-col gap-1.5">
          <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)} rows={2} autoFocus className="input text-xs" />
          <div className="flex gap-2">
            <button
              onClick={() => editDraft.trim() && onSaveEdit(editDraft.trim())}
              disabled={!editDraft.trim()}
              className="rounded bg-brand-500 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
            >
              Save
            </button>
            <button onClick={onCancelEdit} className="rounded px-2.5 py-1 text-[11px] text-ink-muted hover:text-white">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {message.body && (
            <p className="mt-1 inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-surface-field px-3 py-2 text-xs leading-relaxed text-ink-2">
              {renderBody(message.body)}
            </p>
          )}
          {message.attachment && (
            <ChatAttachmentView
              downloadPath={`/chat-rooms/${chatRoomId}/files/${message.attachment.fileId}/download`}
              attachment={message.attachment}
            />
          )}

          <div className="mt-1 flex gap-2 text-[10px] text-ink-muted2 opacity-0 transition group-hover:opacity-100">
            {message.body && (
              <div className="relative">
                <button onClick={onStartForward} className="hover:text-white">
                  Forward
                </button>
                {isForwarding && (
                  <ForwardPicker messageId={message.id} excludeRoomId={chatRoomId} onForwarded={onForwarded} onClose={onStartForward} />
                )}
              </div>
            )}
            {isMine && (
              <button onClick={onStartEdit} className="hover:text-white">
                Edit
              </button>
            )}
            {isMine && (
              <button onClick={onDelete} className="hover:text-danger">
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ForwardPicker({
  messageId,
  excludeRoomId,
  onForwarded,
  onClose,
}: {
  messageId: string;
  excludeRoomId: string;
  onForwarded: () => void;
  onClose: () => void;
}) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<RoomSummary[]>("/chat-rooms").then(setRooms).catch(() => setRooms([]));
  }, []);

  async function forwardTo(roomId: string) {
    setBusyRoomId(roomId);
    setError(null);
    try {
      await apiFetch(`/chat-rooms/${roomId}/messages/forward`, { method: "POST", body: JSON.stringify({ messageId }) });
      onForwarded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to forward");
    } finally {
      setBusyRoomId(null);
    }
  }

  const targets = rooms?.filter((r) => r.id !== excludeRoomId) ?? null;

  return (
    <div className="absolute bottom-full left-0 z-10 mb-1 w-56 rounded-lg border border-surface-border bg-surface-raised p-1.5 shadow-lg">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[10px] font-medium uppercase text-ink-muted">Forward to</span>
        <button onClick={onClose} className="text-ink-muted2 hover:text-white">
          ✕
        </button>
      </div>
      {targets === null && <p className="px-1.5 py-1 text-[11px] text-ink-muted">Loading…</p>}
      {targets?.length === 0 && <p className="px-1.5 py-1 text-[11px] text-ink-muted">No other conversations yet.</p>}
      {error && <p className="px-1.5 py-1 text-[11px] text-danger">{error}</p>}
      <div className="max-h-40 overflow-y-auto">
        {targets?.map((room) => (
          <button
            key={room.id}
            onClick={() => forwardTo(room.id)}
            disabled={busyRoomId === room.id}
            className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-ink-2 hover:bg-surface-field disabled:opacity-50"
          >
            {busyRoomId === room.id ? "Forwarding…" : room.name || (room.type === "DIRECT" ? "Direct message" : "Group chat")}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function TeamChatPageWrapper() {
  return (
    <Suspense fallback={null}>
      <TeamChatPage />
    </Suspense>
  );
}
