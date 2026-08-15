"use client";

import { useState } from "react";
import type { ChatMessagePayload } from "@arutech/types";

interface Props {
  messages: ChatMessagePayload[];
  onSend: (body: string) => void;
  currentUserId: string | null;
}

export function ChatPanel({ messages, onSend, currentUserId }: Props) {
  const [draft, setDraft] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft("");
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3.5">
      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && <p className="text-xs text-ink-muted">No messages yet. Say hello 👋</p>}
        {messages.map((m) => (
          <div key={m.id}>
            <div className="flex items-baseline gap-1.5">
              <b className="text-[11px] font-semibold text-ink-3">{m.senderName}</b>
              {m.senderId === currentUserId && <span className="text-[10px] text-ink-muted2">you</span>}
            </div>
            <p className="mt-1 inline-block max-w-[90%] rounded-lg bg-surface-field px-3 py-2 text-xs leading-relaxed text-ink-2">
              {m.body}
            </p>
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 rounded-lg border border-surface-border2 bg-surface-field px-3 py-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type message here…"
          maxLength={4000}
          className="flex-1 bg-transparent text-xs text-ink-2 outline-none placeholder:text-ink-muted2"
        />
        <button
          type="submit"
          aria-label="Send message"
          className="grid h-5 w-5 flex-none place-items-center rounded-full bg-brand-500 text-white"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 20 22 12 3 4l3 8-3 8Z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
