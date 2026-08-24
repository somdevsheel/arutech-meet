"use client";

import { useEffect, useState } from "react";
import type { ChatMessagePayload } from "@arutech/types";
import { apiFetch } from "@/lib/api-client";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Renders a chat message's attachment — image inline, voice message as an
 * audio player, anything else as a download button. Shared by meeting chat
 * and Team Chat (the only difference between them is which API path signs
 * the download URL, passed in as `downloadPath` rather than each caller
 * re-implementing this rendering). */
export function ChatAttachmentView({
  downloadPath,
  attachment,
}: {
  downloadPath: string;
  attachment: NonNullable<ChatMessagePayload["attachment"]>;
}) {
  if (attachment.mimeType.startsWith("image/")) {
    return <ChatImageAttachment downloadPath={downloadPath} attachment={attachment} />;
  }
  if (attachment.mimeType.startsWith("audio/")) {
    return <ChatVoiceAttachment downloadPath={downloadPath} attachment={attachment} />;
  }
  return <ChatFileAttachment downloadPath={downloadPath} attachment={attachment} />;
}

/** Fetches its own short-lived signed download URL once on mount (see
 * FilesService.getDownloadUrl) — never a raw storage credential or a
 * permanently-valid link, matching how RecordingsPanel's playback works. */
function ChatImageAttachment({
  downloadPath,
  attachment,
}: {
  downloadPath: string;
  attachment: NonNullable<ChatMessagePayload["attachment"]>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<{ url: string }>(downloadPath)
      .then((r) => setUrl(r.url))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadPath]);

  if (!url) return <p className="mt-1 text-[11px] text-ink-muted">Loading image…</p>;
  // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived, per-attachment URL isn't a static asset Next's Image optimizer should cache/rewrite
  return <img src={url} alt={attachment.fileName} className="mt-1 max-h-56 max-w-[70%] rounded-lg border border-surface-border object-cover" />;
}

/** Same signed-URL-on-mount pattern as the image case, rendered as a native
 * audio player instead — a voice message is just a chat attachment whose
 * mimeType happens to be audio/*, no separate model on the wire. */
function ChatVoiceAttachment({
  downloadPath,
  attachment,
}: {
  downloadPath: string;
  attachment: NonNullable<ChatMessagePayload["attachment"]>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<{ url: string }>(downloadPath)
      .then((r) => setUrl(r.url))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadPath]);

  if (!url) return <p className="mt-1 text-[11px] text-ink-muted">Loading voice message…</p>;
  return (
    <audio controls src={url} aria-label={attachment.fileName} className="mt-1 h-9 max-w-[70%]">
      Your browser doesn&apos;t support inline audio playback.
    </audio>
  );
}

function ChatFileAttachment({
  downloadPath,
  attachment,
}: {
  downloadPath: string;
  attachment: NonNullable<ChatMessagePayload["attachment"]>;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const { url } = await apiFetch<{ url: string }>(downloadPath);
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
