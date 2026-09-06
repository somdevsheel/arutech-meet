"use client";

import { useState } from "react";

/** The copy-a-link-and-code section MeetingInfoPanel already had, pulled out
 * so it can be reused where a caller already knows the code/title and
 * doesn't need the rest of that panel (the security summary, recording
 * status) — the dashboard's own "Share" action per meeting, and the lobby
 * screen right after starting an instant meeting (see meeting/[code]/page.tsx
 * and dashboard/page.tsx's hostNow — real gap reported directly: no way to
 * grab the link/code at either of those two points before this, only once
 * already inside a meeting via MeetingInfoPanel's "Invite people"). */
export function ShareLinkBox({ code, title }: { code: string; title?: string }) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const inviteLink = typeof window !== "undefined" ? `${window.location.origin}/meeting/${code}` : "";

  function copy(text: string, mark: (v: boolean) => void) {
    navigator.clipboard.writeText(text);
    mark(true);
    setTimeout(() => mark(false), 2000);
  }

  return (
    <div>
      {title && <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">{title}</h3>}
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={inviteLink}
          onClick={(e) => e.currentTarget.select()}
          className="flex-1 truncate rounded-lg border border-surface-border2 bg-surface-field px-2.5 py-2 text-xs text-ink-2 outline-none"
        />
        <button
          onClick={() => copy(inviteLink, setLinkCopied)}
          className="flex-none rounded-lg border border-surface-border2 bg-surface-field px-3 py-2 text-xs font-medium text-ink-3 hover:brightness-110"
        >
          {linkCopied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
        Meeting code: <b className="font-mono text-ink-2">{code}</b>
        <button onClick={() => copy(code, setCodeCopied)} className="text-brand-300 hover:underline">
          {codeCopied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}
