"use client";

import type { ParticipantPresencePayload } from "@arutech/types";

interface Props {
  participants: ParticipantPresencePayload[];
  isModerator: boolean;
  onMute: (participantId: string) => void;
  onDisableCamera: (participantId: string) => void;
  onRemove: (participantId: string) => void;
  onPromote: (participantId: string) => void;
}

export function ParticipantsPanel({
  participants,
  isModerator,
  onMute,
  onDisableCamera,
  onRemove,
  onPromote,
}: Props) {
  return (
    <div className="h-full overflow-y-auto p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
        In this meeting — {participants.length}
      </p>
      <ul className="space-y-2">
        {participants.map((p) => (
          <li
            key={p.participantId}
            className="flex items-center justify-between rounded-lg bg-surface-border/40 px-3 py-2"
          >
            <div>
              <p className="text-sm text-white">{p.displayName}</p>
              <p className="text-xs text-slate-500">{p.role}</p>
            </div>
            {isModerator && (
              <div className="flex gap-1">
                <IconButton title="Mute" onClick={() => onMute(p.participantId)}>
                  🔇
                </IconButton>
                <IconButton title="Disable camera" onClick={() => onDisableCamera(p.participantId)}>
                  📷
                </IconButton>
                <IconButton title="Make co-host" onClick={() => onPromote(p.participantId)}>
                  ⭐
                </IconButton>
                <IconButton title="Remove" onClick={() => onRemove(p.participantId)}>
                  ✕
                </IconButton>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="rounded px-1.5 py-1 text-xs hover:bg-surface-border"
    >
      {children}
    </button>
  );
}
