"use client";

import { useEffect } from "react";
import type { ActiveReaction } from "@/hooks/use-meeting-socket";

/**
 * Floating emoji reactions over the video area (spec: "display reactions
 * temporarily over participant video"). Purely presentational — the hook
 * (use-meeting-socket) owns the list and already auto-expires each entry after
 * 4s; this component animates them (see the `.reaction-float` keyframes in
 * globals.css) and calls `onDismiss` slightly earlier so state doesn't
 * accumulate stale entries while a tab is backgrounded.
 */
export function ReactionsOverlay({
  reactions,
  onDismiss,
}: {
  reactions: ActiveReaction[];
  onDismiss: (key: string) => void;
}) {
  if (reactions.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex flex-wrap items-end justify-center gap-1">
      {reactions.map((r, i) => (
        <FloatingReaction key={r.key} reaction={r} index={i} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function FloatingReaction({
  reaction,
  index,
  onDismiss,
}: {
  reaction: ActiveReaction;
  index: number;
  onDismiss: (key: string) => void;
}) {
  useEffect(() => {
    const id = setTimeout(() => onDismiss(reaction.key), 3200);
    return () => clearTimeout(id);
  }, [reaction.key, onDismiss]);

  return (
    <span className="reaction-float select-none text-3xl drop-shadow" style={{ animationDelay: `${(index % 5) * 40}ms` }}>
      {reaction.emoji}
    </span>
  );
}
