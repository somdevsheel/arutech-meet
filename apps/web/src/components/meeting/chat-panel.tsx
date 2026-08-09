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
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-slate-500">No messages yet. Say hello 👋</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.senderId === currentUserId ? "text-right" : ""}>
            <p className="text-xs text-slate-500">{m.senderName}</p>
            <p className="inline-block max-w-[85%] rounded-lg bg-surface-border px-3 py-1.5 text-sm text-white">
              {m.body}
            </p>
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-surface-border p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Send a message"
          className="input"
          maxLength={4000}
        />
        <button
          type="submit"
          className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Send
        </button>
      </form>
    </div>
  );
}
