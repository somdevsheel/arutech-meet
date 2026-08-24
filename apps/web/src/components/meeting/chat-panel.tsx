"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { WS_EVENTS, type ChatMessagePayload, type ChatReactionEmoji, type ParticipantPresencePayload } from "@arutech/types";
import { CHAT_REACTION_EMOJIS } from "@arutech/types";
import { apiFetch, ApiError } from "@/lib/api-client";
import { ChatAttachmentView } from "@/components/chat/chat-attachment-view";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
// How long after the last keystroke before we tell the room "stopped typing"
// — long enough that a brief pause mid-sentence doesn't flicker the
// indicator off, short enough that it doesn't linger once someone's clearly
// stepped away from the composer.
const TYPING_STOP_DELAY_MS = 2500;

interface RoomOption {
  id: string;
  type: "GROUP" | "DIRECT" | "MEETING" | "CLASS";
  name: string | null;
  members: { userId: string; user: { displayName: string } }[];
}

interface Props {
  meetingId: string;
  messages: ChatMessagePayload[];
  participants: ParticipantPresencePayload[];
  currentUserId: string | null;
  isModerator: boolean;
  socket: Socket | null;
  onSend: (body: string, opts?: { replyToId?: string; isPrivate?: boolean; toUserId?: string; fileId?: string }) => void;
  onToggleReaction: (messageId: string, emoji: ChatReactionEmoji) => void;
  onDeleteMessage: (messageId: string) => Promise<void>;
  onEditMessage: (messageId: string, body: string) => Promise<void>;
}

/** Splits message text into plain-text/URL/@mention segments for safe
 * rendering — never dangerouslySetInnerHTML; each segment is rendered as
 * either a text node or an `<a>`/`<span>`, so there's no HTML-injection
 * surface no matter what a participant types. */
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

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function uploadAttachment(meetingId: string, file: File): Promise<string> {
  const { fileId, uploadUrl } = await apiFetch<{ fileId: string; uploadUrl: string }>(
    `/meetings/${meetingId}/files/presign`,
    { method: "POST", body: JSON.stringify({ fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size }) },
  );
  // Direct browser -> object storage upload against the presigned URL —
  // deliberately plain fetch, not apiFetch (no auth header belongs here,
  // and this isn't a request to our own API).
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!uploadRes.ok) throw new Error(`Upload failed (${uploadRes.status})`);
  return fileId;
}

export function ChatPanel({
  meetingId,
  messages,
  participants,
  currentUserId,
  isModerator,
  socket,
  onSend,
  onToggleReaction,
  onDeleteMessage,
  onEditMessage,
}: Props) {
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessagePayload | null>(null);
  const [recipientId, setRecipientId] = useState<string>(""); // "" = Everyone; else a userId
  const [openReactionPickerId, setOpenReactionPickerId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [forwardingId, setForwardingId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [typingUserIds, setTypingUserIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasTypingRef = useRef(false);
  const voice = useVoiceRecorder();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  useEffect(() => {
    if (!socket) return;
    const onTyping = (p: { userId: string; isTyping: boolean }) => {
      if (p.userId === currentUserId) return;
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
  }, [socket, currentUserId]);

  const others = participants.filter((p) => p.userId && p.userId !== currentUserId);
  const messageById = new Map(messages.map((m) => [m.id, m]));
  const typingNames = [...typingUserIds]
    .map((id) => participants.find((p) => p.userId === id)?.displayName)
    .filter((name): name is string => Boolean(name));

  function handleDraftChange(value: string) {
    setDraft(value);
    if (!socket) return;
    if (value.trim() && !wasTypingRef.current) {
      wasTypingRef.current = true;
      socket.emit(WS_EVENTS.CHAT_TYPING, { meetingId, isTyping: true });
    }
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = setTimeout(() => {
      wasTypingRef.current = false;
      socket.emit(WS_EVENTS.CHAT_TYPING, { meetingId, isTyping: false });
    }, TYPING_STOP_DELAY_MS);
  }

  function stopTypingNow() {
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    if (wasTypingRef.current && socket) {
      wasTypingRef.current = false;
      socket.emit(WS_EVENTS.CHAT_TYPING, { meetingId, isTyping: false });
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    stopTypingNow();
    onSend(body, {
      replyToId: replyTo?.id,
      isPrivate: Boolean(recipientId),
      toUserId: recipientId || undefined,
    });
    setDraft("");
    setReplyTo(null);
  }

  async function pickFile() {
    fileInputRef.current?.click();
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setUploadError(null);

    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(`${file.name} is too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`);
      return;
    }

    setUploading(true);
    try {
      const fileId = await uploadAttachment(meetingId, file);
      onSend(draft.trim(), {
        replyToId: replyTo?.id,
        isPrivate: Boolean(recipientId),
        toUserId: recipientId || undefined,
        fileId,
      });
      setDraft("");
      setReplyTo(null);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function stopVoiceAndSend() {
    const file = await voice.stop();
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fileId = await uploadAttachment(meetingId, file);
      onSend("", { replyToId: replyTo?.id, isPrivate: Boolean(recipientId), toUserId: recipientId || undefined, fileId });
      setReplyTo(null);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to send voice message");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3.5">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && <p className="text-xs text-ink-muted">No messages yet. Say hello 👋</p>}
        {messages.map((m) => (
          <ChatMessage
            key={m.id}
            meetingId={meetingId}
            message={m}
            quoted={m.replyToId ? messageById.get(m.replyToId) ?? null : null}
            currentUserId={currentUserId}
            canDelete={!m.deletedAt && (m.senderId === currentUserId || isModerator)}
            canEdit={!m.deletedAt && m.senderId === currentUserId}
            isEditing={editingId === m.id}
            reactionPickerOpen={openReactionPickerId === m.id}
            isForwarding={forwardingId === m.id}
            onToggleReactionPicker={() => setOpenReactionPickerId((cur) => (cur === m.id ? null : m.id))}
            onReact={(emoji) => {
              onToggleReaction(m.id, emoji);
              setOpenReactionPickerId(null);
            }}
            onReply={() => setReplyTo(m)}
            onDelete={() => onDeleteMessage(m.id)}
            onStartEdit={() => setEditingId(m.id)}
            onCancelEdit={() => setEditingId(null)}
            onSaveEdit={async (body) => {
              await onEditMessage(m.id, body);
              setEditingId(null);
            }}
            onStartForward={() => setForwardingId((cur) => (cur === m.id ? null : m.id))}
            onForwarded={() => setForwardingId(null)}
          />
        ))}
        {typingNames.length > 0 && (
          <p className="text-[11px] italic text-ink-muted">
            {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing…
          </p>
        )}
      </div>

      {uploadError && <p className="text-xs text-danger">{uploadError}</p>}

      {replyTo && (
        <div className="flex items-center justify-between rounded-lg border border-surface-border2 bg-surface-field px-3 py-2 text-xs">
          <span className="min-w-0 truncate text-ink-muted">
            Replying to <b className="text-ink-2">{replyTo.senderName}</b>: {replyTo.body ?? "(deleted)"}
          </span>
          <button onClick={() => setReplyTo(null)} className="ml-2 flex-none text-ink-muted2 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {others.length > 0 && (
        <select
          value={recipientId}
          onChange={(e) => setRecipientId(e.target.value)}
          className="rounded-lg border border-surface-border2 bg-surface-field px-2.5 py-1.5 text-[11px] text-ink-2 outline-none"
        >
          <option value="">To: Everyone</option>
          {others.map((p) => (
            <option key={p.userId} value={p.userId!}>
              To: {p.displayName} (private)
            </option>
          ))}
        </select>
      )}

      {voice.recording ? (
        <div className="flex items-center gap-2 rounded-lg border border-danger bg-danger/10 px-3 py-2.5">
          <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-danger" />
          <span className="flex-1 text-xs text-ink-2">
            Recording… {String(Math.floor(voice.elapsed / 60)).padStart(2, "0")}:{String(voice.elapsed % 60).padStart(2, "0")}
          </span>
          <button onClick={() => voice.cancel()} className="text-xs text-ink-muted2 hover:text-white">
            Cancel
          </button>
          <button
            onClick={stopVoiceAndSend}
            className="rounded-lg bg-brand-500 px-3 py-1 text-xs font-medium text-white hover:bg-brand-600"
          >
            Send
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex items-center gap-2 rounded-lg border border-surface-border2 bg-surface-field px-3 py-2.5">
          <input ref={fileInputRef} type="file" className="hidden" onChange={onFileSelected} />
          <button
            type="button"
            onClick={pickFile}
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
            placeholder={uploading ? "Uploading…" : "Type message here…"}
            maxLength={4000}
            disabled={uploading}
            className="flex-1 bg-transparent text-xs text-ink-2 outline-none placeholder:text-ink-muted2"
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={uploading || !draft.trim()}
            className="grid h-5 w-5 flex-none place-items-center rounded-full bg-brand-500 text-white disabled:opacity-40"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 20 22 12 3 4l3 8-3 8Z" />
            </svg>
          </button>
        </form>
      )}
      {voice.error && <p className="text-xs text-danger">{voice.error}</p>}
    </div>
  );
}

function ChatMessage({
  meetingId,
  message,
  quoted,
  currentUserId,
  canDelete,
  canEdit,
  isEditing,
  reactionPickerOpen,
  isForwarding,
  onToggleReactionPicker,
  onReact,
  onReply,
  onDelete,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onStartForward,
  onForwarded,
}: {
  meetingId: string;
  message: ChatMessagePayload;
  quoted: ChatMessagePayload | null;
  currentUserId: string | null;
  canDelete: boolean;
  canEdit: boolean;
  isEditing: boolean;
  reactionPickerOpen: boolean;
  isForwarding: boolean;
  onToggleReactionPicker: () => void;
  onReact: (emoji: ChatReactionEmoji) => void;
  onReply: () => void;
  onDelete: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (body: string) => Promise<void>;
  onStartForward: () => void;
  onForwarded: () => void;
}) {
  const isDeleted = Boolean(message.deletedAt);
  const [editDraft, setEditDraft] = useState(message.body ?? "");

  return (
    <div className="group">
      <div className="flex items-baseline gap-1.5">
        <b className="text-[11px] font-semibold text-ink-3">{message.senderName}</b>
        {message.senderId === currentUserId && <span className="text-[10px] text-ink-muted2">you</span>}
        {message.isPrivate && <span className="text-[10px] text-warn">· private</span>}
        <span className="text-[10px] text-ink-muted2">{formatTime(message.createdAt)}</span>
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

      {quoted && !isDeleted && (
        <div className="mt-1 border-l-2 border-surface-border2 pl-2 text-[11px] text-ink-muted">
          <b>{quoted.senderName}</b>: {quoted.body ?? "(deleted)"}
        </div>
      )}

      {isDeleted ? (
        <p className="mt-1 inline-block text-xs italic text-ink-muted">Message deleted</p>
      ) : isEditing ? (
        <div className="mt-1 flex max-w-[90%] flex-col gap-1.5">
          <textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            rows={2}
            autoFocus
            className="input text-xs"
          />
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
            <p className="mt-1 inline-block max-w-[90%] whitespace-pre-wrap break-words rounded-lg bg-surface-field px-3 py-2 text-xs leading-relaxed text-ink-2">
              {renderBody(message.body)}
            </p>
          )}
          {message.attachment && (
            <ChatAttachmentView
              downloadPath={`/meetings/${meetingId}/files/${message.attachment.fileId}/download`}
              attachment={message.attachment}
            />
          )}

          {message.reactions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {message.reactions.map((r) => (
                <button
                  key={r.emoji}
                  onClick={() => onReact(r.emoji as ChatReactionEmoji)}
                  className={`rounded-full border px-1.5 py-0.5 text-[11px] ${
                    currentUserId && r.userIds.includes(currentUserId)
                      ? "border-brand-500 bg-brand-500/20 text-brand-300"
                      : "border-surface-border2 text-ink-muted"
                  }`}
                >
                  {r.emoji} {r.userIds.length}
                </button>
              ))}
            </div>
          )}

          <div className="mt-1 flex gap-2 text-[10px] text-ink-muted2 opacity-0 transition group-hover:opacity-100">
            <div className="relative">
              <button onClick={onToggleReactionPicker} className="hover:text-white">
                React
              </button>
              {reactionPickerOpen && (
                <div className="absolute bottom-full left-0 z-10 mb-1 flex gap-0.5 rounded-lg border border-surface-border bg-surface-raised p-1 shadow-lg">
                  {CHAT_REACTION_EMOJIS.map((emoji) => (
                    <button key={emoji} onClick={() => onReact(emoji)} className="rounded px-1 text-sm hover:bg-surface-field">
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onReply} className="hover:text-white">
              Reply
            </button>
            {message.body && (
              <div className="relative">
                <button onClick={onStartForward} className="hover:text-white">
                  Forward
                </button>
                {isForwarding && (
                  <ForwardPicker
                    messageId={message.id}
                    currentUserId={currentUserId}
                    onForwarded={onForwarded}
                    onClose={onStartForward}
                  />
                )}
              </div>
            )}
            {canEdit && (
              <button onClick={onStartEdit} className="hover:text-white">
                Edit
              </button>
            )}
            {canDelete && (
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

/** Lists the caller's own chat rooms (Team Chat GROUP/DIRECT) to forward
 * this message's text into — fetched lazily only when the picker actually
 * opens, not on every message render. */
function ForwardPicker({
  messageId,
  currentUserId,
  onForwarded,
  onClose,
}: {
  messageId: string;
  currentUserId: string | null;
  onForwarded: () => void;
  onClose: () => void;
}) {
  const [rooms, setRooms] = useState<RoomOption[] | null>(null);
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<RoomOption[]>("/chat-rooms").then(setRooms).catch(() => setRooms([]));
  }, []);

  function roomLabel(room: RoomOption) {
    if (room.type === "GROUP") return room.name || "Group chat";
    // DIRECT: show the OTHER member, not whichever one happens to be first
    // in the members array — that's frequently the caller themselves.
    const other = room.members.find((m) => m.userId !== currentUserId);
    return other?.user.displayName ?? "Direct message";
  }

  async function forwardTo(roomId: string) {
    setBusyRoomId(roomId);
    setError(null);
    try {
      await apiFetch(`/chat-rooms/${roomId}/messages/forward`, {
        method: "POST",
        body: JSON.stringify({ messageId }),
      });
      onForwarded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to forward");
    } finally {
      setBusyRoomId(null);
    }
  }

  return (
    <div className="absolute bottom-full left-0 z-10 mb-1 w-56 rounded-lg border border-surface-border bg-surface-raised p-1.5 shadow-lg">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[10px] font-medium uppercase text-ink-muted">Forward to</span>
        <button onClick={onClose} className="text-ink-muted2 hover:text-white">
          ✕
        </button>
      </div>
      {rooms === null && <p className="px-1.5 py-1 text-[11px] text-ink-muted">Loading…</p>}
      {rooms?.length === 0 && <p className="px-1.5 py-1 text-[11px] text-ink-muted">No Team Chat conversations yet.</p>}
      {error && <p className="px-1.5 py-1 text-[11px] text-danger">{error}</p>}
      <div className="max-h-40 overflow-y-auto">
        {rooms?.map((room) => (
          <button
            key={room.id}
            onClick={() => forwardTo(room.id)}
            disabled={busyRoomId === room.id}
            className="block w-full rounded px-2 py-1.5 text-left text-[11px] text-ink-2 hover:bg-surface-field disabled:opacity-50"
          >
            {busyRoomId === room.id ? "Forwarding…" : roomLabel(room)}
          </button>
        ))}
      </div>
    </div>
  );
}
