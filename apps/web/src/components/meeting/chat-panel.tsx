"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessagePayload, ChatReactionEmoji, ParticipantPresencePayload } from "@arutech/types";
import { CHAT_REACTION_EMOJIS } from "@arutech/types";
import { apiFetch, ApiError } from "@/lib/api-client";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

interface Props {
  meetingId: string;
  messages: ChatMessagePayload[];
  participants: ParticipantPresencePayload[];
  currentUserId: string | null;
  isModerator: boolean;
  onSend: (body: string, opts?: { replyToId?: string; isPrivate?: boolean; toUserId?: string; fileId?: string }) => void;
  onToggleReaction: (messageId: string, emoji: ChatReactionEmoji) => void;
  onDeleteMessage: (messageId: string) => Promise<void>;
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

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatPanel({
  meetingId,
  messages,
  participants,
  currentUserId,
  isModerator,
  onSend,
  onToggleReaction,
  onDeleteMessage,
}: Props) {
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessagePayload | null>(null);
  const [recipientId, setRecipientId] = useState<string>(""); // "" = Everyone; else a userId
  const [openReactionPickerId, setOpenReactionPickerId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  const others = participants.filter((p) => p.userId && p.userId !== currentUserId);
  const messageById = new Map(messages.map((m) => [m.id, m]));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
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
      setUploadError(`${file.name} is too large (max ${formatSize(MAX_UPLOAD_BYTES)})`);
      return;
    }

    setUploading(true);
    try {
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
            reactionPickerOpen={openReactionPickerId === m.id}
            onToggleReactionPicker={() => setOpenReactionPickerId((cur) => (cur === m.id ? null : m.id))}
            onReact={(emoji) => {
              onToggleReaction(m.id, emoji);
              setOpenReactionPickerId(null);
            }}
            onReply={() => setReplyTo(m)}
            onDelete={() => onDeleteMessage(m.id)}
          />
        ))}
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
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
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
    </div>
  );
}

function ChatMessage({
  meetingId,
  message,
  quoted,
  currentUserId,
  canDelete,
  reactionPickerOpen,
  onToggleReactionPicker,
  onReact,
  onReply,
  onDelete,
}: {
  meetingId: string;
  message: ChatMessagePayload;
  quoted: ChatMessagePayload | null;
  currentUserId: string | null;
  canDelete: boolean;
  reactionPickerOpen: boolean;
  onToggleReactionPicker: () => void;
  onReact: (emoji: ChatReactionEmoji) => void;
  onReply: () => void;
  onDelete: () => void;
}) {
  const isDeleted = Boolean(message.deletedAt);

  return (
    <div className="group">
      <div className="flex items-baseline gap-1.5">
        <b className="text-[11px] font-semibold text-ink-3">{message.senderName}</b>
        {message.senderId === currentUserId && <span className="text-[10px] text-ink-muted2">you</span>}
        {message.isPrivate && <span className="text-[10px] text-warn">· private</span>}
        <span className="text-[10px] text-ink-muted2">{formatTime(message.createdAt)}</span>
      </div>

      {quoted && !isDeleted && (
        <div className="mt-1 border-l-2 border-surface-border2 pl-2 text-[11px] text-ink-muted">
          <b>{quoted.senderName}</b>: {quoted.body ?? "(deleted)"}
        </div>
      )}

      {isDeleted ? (
        <p className="mt-1 inline-block text-xs italic text-ink-muted">Message deleted</p>
      ) : (
        <>
          {message.body && (
            <p className="mt-1 inline-block max-w-[90%] whitespace-pre-wrap break-words rounded-lg bg-surface-field px-3 py-2 text-xs leading-relaxed text-ink-2">
              {renderBody(message.body)}
            </p>
          )}
          {message.attachment && <AttachmentView meetingId={meetingId} attachment={message.attachment} />}

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

function AttachmentView({
  meetingId,
  attachment,
}: {
  meetingId: string;
  attachment: NonNullable<ChatMessagePayload["attachment"]>;
}) {
  const isImage = attachment.mimeType.startsWith("image/");

  if (isImage) {
    return <ChatImageAttachment meetingId={meetingId} attachment={attachment} />;
  }
  return <ChatFileAttachment meetingId={meetingId} attachment={attachment} />;
}

/** Fetches its own short-lived signed download URL once on mount (see
 * FilesService.getDownloadUrl) — never a raw storage credential or a
 * permanently-valid link, matching how RecordingsPanel's playback works. */
function ChatImageAttachment({
  meetingId,
  attachment,
}: {
  meetingId: string;
  attachment: NonNullable<ChatMessagePayload["attachment"]>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<{ url: string }>(`/meetings/${meetingId}/files/${attachment.fileId}/download`)
      .then((r) => setUrl(r.url))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, attachment.fileId]);

  if (!url) return <p className="mt-1 text-[11px] text-ink-muted">Loading image…</p>;
  // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived, per-attachment URL isn't a static asset Next's Image optimizer should cache/rewrite
  return <img src={url} alt={attachment.fileName} className="mt-1 max-h-56 max-w-[70%] rounded-lg border border-surface-border object-cover" />;
}

function ChatFileAttachment({
  meetingId,
  attachment,
}: {
  meetingId: string;
  attachment: NonNullable<ChatMessagePayload["attachment"]>;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const { url } = await apiFetch<{ url: string }>(`/meetings/${meetingId}/files/${attachment.fileId}/download`);
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={download}
      disabled={busy}
      className="mt-1 flex items-center gap-2 rounded-lg border border-surface-border2 bg-surface-field px-3 py-2 text-xs text-ink-2 hover:border-brand-500 disabled:opacity-60"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-none">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
      </svg>
      <span className="truncate">{attachment.fileName}</span>
      <span className="flex-none text-ink-muted2">{formatSize(Number(attachment.sizeBytes))}</span>
    </button>
  );
}
