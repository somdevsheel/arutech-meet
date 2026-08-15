"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WS_EVENTS, type ChatMessagePayload } from "@arutech/types";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { getSocket } from "@/lib/socket";
import { AppShell } from "@/components/layout/app-shell";
import { NewRoomModal } from "@/components/chat/new-room-modal";

interface RoomMember {
  user: { id: string; displayName: string; username: string; avatarUrl: string | null };
  lastReadMessageId: string | null;
  userId: string;
}

interface RoomSummary {
  id: string;
  type: "GROUP" | "DIRECT" | "MEETING" | "CLASS";
  name: string | null;
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

function TeamChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, accessToken, clear, hasHydrated } = useAuthStore();
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("room"));
  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const [draft, setDraft] = useState("");
  const [showNewRoom, setShowNewRoom] = useState(false);

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

  // Join the selected room's realtime channel, load history, and mark it read.
  useEffect(() => {
    if (!selectedId || !accessToken) return;
    const socket = getSocket(accessToken);
    socket.emit(WS_EVENTS.ROOM_JOIN, { chatRoomId: selectedId });
    apiFetch<{ id: string; senderId: string | null; sender: { displayName: string } | null; body: string; createdAt: string; replyToId: string | null }[]>(
      `/chat-rooms/${selectedId}/messages`,
    ).then((history) => {
      setMessages(
        history
          .slice()
          .reverse()
          .map((m) => ({
            id: m.id,
            chatRoomId: selectedId,
            senderId: m.senderId,
            senderName: m.sender?.displayName ?? "Unknown",
            body: m.body,
            replyToId: m.replyToId,
            isPrivate: false,
            toUserId: null,
            createdAt: m.createdAt,
          })),
      );
    });
    apiFetch(`/chat-rooms/${selectedId}/read`, { method: "POST" }).catch(() => {});

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
      setRooms((prev) =>
        prev
          ? prev
              .map((r) =>
                r.id === payload.chatRoomId
                  ? { ...r, messages: [{ id: payload.id, body: payload.body, createdAt: payload.createdAt }] }
                  : r,
              )
              .sort((a, b) => {
                const at = a.messages[0]?.createdAt ?? "";
                const bt = b.messages[0]?.createdAt ?? "";
                return at < bt ? 1 : -1;
              })
          : prev,
      );
    };
    socket.on(WS_EVENTS.ROOM_MESSAGE, onMessage);
    return () => {
      socket.off(WS_EVENTS.ROOM_MESSAGE, onMessage);
    };
  }, [accessToken, selectedId]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !selectedId || !accessToken) return;
    getSocket(accessToken).emit(WS_EVENTS.ROOM_MESSAGE, { chatRoomId: selectedId, body });
    setDraft("");
  }

  if (!user) return null;

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
              return (
                <li key={room.id}>
                  <button
                    onClick={() => setSelectedId(room.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                      selectedId === room.id ? "bg-brand-tint2" : "hover:bg-surface-elevated"
                    }`}
                  >
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-brand-500 text-[10px] font-semibold text-white">
                      {initialsOf(roomTitle(room, user.id))}
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
              <div className="border-b border-surface-border px-4 py-3">
                <p className="text-sm font-semibold text-white">{roomTitle(selected, user.id)}</p>
                {selected.type === "GROUP" && (
                  <p className="text-xs text-ink-muted">{selected.members.length} members</p>
                )}
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.length === 0 && <p className="text-xs text-ink-muted">No messages yet. Say hello 👋</p>}
                {messages.map((m) => (
                  <div key={m.id}>
                    <div className="flex items-baseline gap-1.5">
                      <b className="text-[11px] font-semibold text-ink-3">
                        {m.senderId === user.id ? "You" : m.senderName}
                      </b>
                      <span className="text-[10px] text-ink-muted2">
                        {new Date(m.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="mt-1 inline-block max-w-[85%] rounded-lg bg-surface-field px-3 py-2 text-xs leading-relaxed text-ink-2">
                      {m.body}
                    </p>
                  </div>
                ))}
              </div>
              <form onSubmit={send} className="flex items-center gap-2 border-t border-surface-border p-3">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Type a message…"
                  className="input flex-1"
                  maxLength={4000}
                />
                <button
                  type="submit"
                  className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
                >
                  Send
                </button>
              </form>
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
    </AppShell>
  );
}

export default function TeamChatPageWrapper() {
  return (
    <Suspense fallback={null}>
      <TeamChatPage />
    </Suspense>
  );
}
