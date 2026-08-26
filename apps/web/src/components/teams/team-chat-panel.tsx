"use client";

import { useEffect, useState } from "react";
import { WS_EVENTS, type ChatMessagePayload } from "@arutech/types";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { getSocket } from "@/lib/socket";
import { ChatAttachmentView } from "@/components/chat/chat-attachment-view";

function renderBody(text: string) {
  const tokenPattern = /(https?:\/\/[^\s]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = tokenPattern.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <a key={key++} href={match[0]} target="_blank" rel="noopener noreferrer" className="text-brand-300 underline">
        {match[0]}
      </a>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

/**
 * Real-time chat for a Team's room — the exact same `ChatRoom`/`ChatMember`
 * infrastructure Team Chat groups (Stage 23/24) already use; a team's room
 * is just `type: TEAM` instead of `GROUP`, and `ChatService`'s room-scoped
 * methods only ever check `ChatMember` existence, never the room's type.
 * Deliberately v1-scoped, the same way Stage 23 shipped group management
 * before Stage 24 added edit/forward/voice/typing to it — this panel has
 * real send/receive/edit/delete, but not yet forward, voice messages, or a
 * typing indicator. Nothing server-side is missing for those (they'd work
 * immediately on this same room), only this component doesn't expose them
 * yet.
 */
export function TeamChatPanel({ chatRoomId }: { chatRoomId: string }) {
  const { user, accessToken } = useAuthStore();
  const [messages, setMessages] = useState<ChatMessagePayload[] | null>(null);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ChatMessagePayload[]>(`/chat-rooms/${chatRoomId}/messages`).then(setMessages);
    apiFetch(`/chat-rooms/${chatRoomId}/read`, { method: "POST" }).catch(() => {});
  }, [chatRoomId]);

  useEffect(() => {
    if (!accessToken) return;
    const socket = getSocket(accessToken);
    socket.emit(WS_EVENTS.ROOM_JOIN, { chatRoomId });

    const onMessage = (payload: ChatMessagePayload & { chatRoomId: string }) => {
      if (payload.chatRoomId !== chatRoomId) return;
      // Dedup by id — React Strict Mode's dev-only double-effect-invocation
      // can otherwise double-register this listener for an instant, same
      // guard the existing chat/page.tsx room listener already uses.
      setMessages((prev) => (prev?.some((m) => m.id === payload.id) ? prev : [...(prev ?? []), payload]));
    };
    const onEdited = (updated: ChatMessagePayload) =>
      setMessages((prev) => prev?.map((m) => (m.id === updated.id ? updated : m)) ?? prev);
    const onDeleted = (p: { messageId: string }) =>
      setMessages(
        (prev) =>
          prev?.map((m) => (m.id === p.messageId ? { ...m, body: null, deletedAt: new Date().toISOString() } : m)) ??
          prev,
      );

    socket.on(WS_EVENTS.ROOM_MESSAGE, onMessage);
    socket.on(WS_EVENTS.ROOM_MESSAGE_EDITED, onEdited);
    socket.on(WS_EVENTS.ROOM_MESSAGE_DELETED, onDeleted);
    return () => {
      socket.emit(WS_EVENTS.ROOM_LEAVE, { chatRoomId });
      socket.off(WS_EVENTS.ROOM_MESSAGE, onMessage);
      socket.off(WS_EVENTS.ROOM_MESSAGE_EDITED, onEdited);
      socket.off(WS_EVENTS.ROOM_MESSAGE_DELETED, onDeleted);
    };
  }, [accessToken, chatRoomId]);

  function send() {
    if (!draft.trim() || !accessToken) return;
    getSocket(accessToken).emit(WS_EVENTS.ROOM_MESSAGE, { chatRoomId, body: draft.trim() });
    setDraft("");
  }

  async function saveEdit(messageId: string, body: string) {
    await apiFetch(`/chat-rooms/${chatRoomId}/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
    setEditingId(null);
  }

  async function remove(messageId: string) {
    await apiFetch(`/chat-rooms/${chatRoomId}/messages/${messageId}`, { method: "DELETE" });
  }

  if (!user) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages === null && <p className="text-xs text-ink-muted">Loading…</p>}
        {messages?.length === 0 && <p className="text-xs text-ink-muted">No messages yet. Say hello 👋</p>}
        {messages?.map((m) => (
          <TeamChatMessageRow
            key={m.id}
            chatRoomId={chatRoomId}
            message={m}
            currentUserId={user.id}
            isEditing={editingId === m.id}
            onStartEdit={() => setEditingId(m.id)}
            onCancelEdit={() => setEditingId(null)}
            onSaveEdit={(body) => saveEdit(m.id, body)}
            onDelete={() => remove(m.id)}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-surface-border p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type a message…"
          className="input flex-1"
        />
        <button
          onClick={send}
          disabled={!draft.trim()}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function TeamChatMessageRow({
  chatRoomId,
  message,
  currentUserId,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  chatRoomId: string;
  message: ChatMessagePayload;
  currentUserId: string;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (body: string) => Promise<void>;
  onDelete: () => void;
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
          {isMine && (
            <div className="mt-1 flex gap-2 text-[10px] text-ink-muted2 opacity-0 transition group-hover:opacity-100">
              {message.body && (
                <button onClick={onStartEdit} className="hover:text-white">
                  Edit
                </button>
              )}
              <button onClick={onDelete} className="hover:text-danger">
                Delete
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
