"use client";

import type { ParticipantPresencePayload } from "@arutech/types";

interface Props {
  participants: ParticipantPresencePayload[];
  isModerator: boolean;
  onMute: (participantId: string) => void;
  onDisableCamera: (participantId: string) => void;
  onRemove: (participantId: string) => void;
  onPromote: (participantId: string) => void;
  onLowerHand: (userId: string) => void;
}

const AVATAR_COLORS = ["#3B6FE0", "#8E44AD", "#16A085", "#D35400", "#2C7A7B", "#C0392B", "#B8860B"];

function colorFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function ParticipantsPanel({
  participants,
  isModerator,
  onMute,
  onDisableCamera,
  onRemove,
  onPromote,
  onLowerHand,
}: Props) {
  // Raised hands first (mirrors Zoom/Meet — the people waiting to be heard
  // surface to the top), then stable original order otherwise.
  const sorted = [...participants].sort((a, b) => Number(b.handRaised) - Number(a.handRaised));

  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto p-2.5">
      {sorted.map((p) => (
        <div
          key={p.participantId}
          className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-surface-elevated"
        >
          <span
            className="grid h-7 w-7 flex-none place-items-center rounded-full text-[10px] font-semibold text-white"
            style={{ background: colorFor(p.participantId) }}
          >
            {p.displayName.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="truncate text-xs font-medium text-ink-2">{p.displayName}</span>
              <span className="flex-none text-[10px] text-ink-muted">· {p.role}</span>
              {p.handRaised && <span title="Hand raised">✋</span>}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-ink-muted2">
              <StateIcon title={p.micEnabled ? "Microphone on" : "Microphone off"} off={!p.micEnabled}>
                {p.micEnabled ? (
                  <path d="M9 9V6a3 3 0 0 1 6 0v5a3 3 0 0 1-.05.55M5 11a7 7 0 0 0 10.5 6M12 18v3" />
                ) : (
                  <path d="M9 9V6a3 3 0 0 1 6 0v5M5 11a7 7 0 0 0 10.5 6M12 18v3M3 3l18 18" />
                )}
              </StateIcon>
              <StateIcon title={p.cameraEnabled ? "Camera on" : "Camera off"} off={!p.cameraEnabled}>
                {p.cameraEnabled ? (
                  <>
                    <rect x="3" y="6" width="12" height="12" rx="2" />
                    <path d="m15 11 6-4v10l-6-4" />
                  </>
                ) : (
                  <path d="M3 6h9a2 2 0 0 1 2 2v8M21 7v10l-6-4M3 3l18 18" />
                )}
              </StateIcon>
              {p.isScreenSharing && (
                <StateIcon title="Sharing screen">
                  <rect x="3" y="4" width="18" height="13" rx="2" />
                  <path d="M8 21h8" />
                </StateIcon>
              )}
            </div>
          </div>
          {isModerator && (
            <div className="flex flex-none gap-0.5">
              {p.handRaised && p.userId && (
                <IconButton title="Lower hand" onClick={() => onLowerHand(p.userId!)}>
                  <path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11.5V6a1.5 1.5 0 0 1 3 0v8c0 3.3-2.7 6-6 6h-1a6 6 0 0 1-5-2.7L3 13.5a1.4 1.4 0 0 1 2.2-1.7L8 15" />
                </IconButton>
              )}
              <IconButton title="Mute" onClick={() => onMute(p.participantId)}>
                <path d="M9 9V6a3 3 0 0 1 6 0v5M5 11a7 7 0 0 0 10.5 6M12 18v3M3 3l18 18" />
              </IconButton>
              <IconButton title="Disable camera" onClick={() => onDisableCamera(p.participantId)}>
                <path d="M3 6h9a2 2 0 0 1 2 2v8M21 7v10l-6-4M3 3l18 18" />
              </IconButton>
              <IconButton title="Make co-host" onClick={() => onPromote(p.participantId)}>
                <path d="M12 3.5 14.5 9l6 .6-4.5 4 1.3 5.9L12 16.7 6.7 19.5 8 13.6l-4.5-4L9.5 9 12 3.5Z" />
              </IconButton>
              <IconButton title="Remove" onClick={() => onRemove(p.participantId)}>
                <path d="M18 6 6 18M6 6l12 12" />
              </IconButton>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StateIcon({ children, title, off }: { children: React.ReactNode; title: string; off?: boolean }) {
  return (
    <span title={title} className={off ? "text-danger" : "text-success"}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        {children}
      </svg>
    </span>
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
      className="grid h-6 w-6 place-items-center rounded text-ink-muted2 hover:bg-surface-chip hover:text-white"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {children}
      </svg>
    </button>
  );
}
