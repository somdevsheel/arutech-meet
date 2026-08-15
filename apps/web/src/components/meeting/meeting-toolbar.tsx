"use client";

import { useLocalParticipant } from "@livekit/components-react";
import { useState } from "react";

export type PanelKind = "participants" | "chat" | "tools" | "recordings";

interface Props {
  activePanel: PanelKind | null;
  onTogglePanel: (panel: PanelKind) => void;
  onLeave: () => void;
  isRecording: boolean;
  canShareScreen: boolean;
  participantCount: number;
  unreadChatCount: number;
}

/** Custom toolbar (not LiveKit's prebuilt ControlBar) so the room has its own visual
 * identity per the product's design system, while still driving the same real
 * LiveKit local-participant APIs underneath. */
export function MeetingToolbar({
  activePanel,
  onTogglePanel,
  onLeave,
  isRecording,
  canShareScreen,
  participantCount,
  unreadChatCount,
}: Props) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant();
  const [busy, setBusy] = useState(false);

  async function toggle(kind: "mic" | "cam" | "screen") {
    setBusy(true);
    try {
      if (kind === "mic") await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
      if (kind === "cam") await localParticipant.setCameraEnabled(!isCameraEnabled);
      if (kind === "screen") {
        await localParticipant.setScreenShareEnabled(!isScreenShareEnabled, {
          audio: true,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <footer className="flex h-20 flex-none items-center justify-between gap-4 border-t border-surface-border bg-surface-raised px-6">
      <div className="flex items-center gap-1.5">
        <Control
          label={isMicrophoneEnabled ? "Mute" : "Unmute"}
          off={!isMicrophoneEnabled}
          disabled={busy}
          onClick={() => toggle("mic")}
        >
          {isMicrophoneEnabled ? (
            <path d="M9 9V6a3 3 0 0 1 6 0v5a3 3 0 0 1-.05.55M5 11a7 7 0 0 0 10.5 6M12 18v3" />
          ) : (
            <path d="M9 9V6a3 3 0 0 1 6 0v5M5 11a7 7 0 0 0 10.5 6M12 18v3M3 3l18 18" />
          )}
        </Control>
        <Control
          label={isCameraEnabled ? "Stop video" : "Start video"}
          off={!isCameraEnabled}
          disabled={busy}
          onClick={() => toggle("cam")}
        >
          <rect x="3" y="6" width="12" height="12" rx="2" />
          <path d="m15 11 6-4v10l-6-4" />
        </Control>
      </div>

      <div className="flex items-center gap-1.5">
        <Control
          label="Participants"
          badge={participantCount}
          active={activePanel === "participants"}
          onClick={() => onTogglePanel("participants")}
        >
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 20a6 6 0 0 1 12 0" />
          <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 20a5.6 5.6 0 0 0-2-4" />
        </Control>
        <Control
          label="Chat"
          badge={unreadChatCount}
          active={activePanel === "chat"}
          onClick={() => onTogglePanel("chat")}
        >
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-5.2A8 8 0 1 1 21 12Z" />
        </Control>
        {canShareScreen && (
          <button
            onClick={() => toggle("screen")}
            disabled={busy}
            className={`flex flex-col items-center gap-1.5 rounded-lg px-4 py-1.5 text-[11px] font-semibold transition disabled:opacity-50 ${
              isScreenShareEnabled ? "bg-success text-white" : "bg-success-bg text-success hover:brightness-110"
            }`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="4" width="18" height="13" rx="2" />
              <path d="M12 13V7m0 0-2.5 2.5M12 7l2.5 2.5M8 21h8" />
            </svg>
            {isScreenShareEnabled ? "Stop sharing" : "Share screen"}
          </button>
        )}
        <Control
          label={isRecording ? "Recording" : "Record"}
          active={activePanel === "recordings"}
          accentActive={isRecording}
          onClick={() => onTogglePanel("recordings")}
        >
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
        </Control>
        <Control
          label="Tools"
          active={activePanel === "tools"}
          onClick={() => onTogglePanel("tools")}
        >
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </Control>
      </div>

      <button
        onClick={onLeave}
        className="flex-none rounded-lg bg-danger-strong px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
      >
        Leave
      </button>
    </footer>
  );
}

function Control({
  children,
  label,
  onClick,
  disabled,
  off,
  active,
  accentActive,
  badge,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  off?: boolean;
  active?: boolean;
  accentActive?: boolean;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`relative flex flex-col items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
        active ? "bg-surface-field text-white" : "text-ink-3 hover:bg-surface-field"
      }`}
    >
      <span className={off ? "text-danger" : accentActive ? "text-danger" : ""}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          {children}
        </svg>
      </span>
      {label}
      {!!badge && (
        <span className="absolute -right-0.5 -top-0.5 rounded-full bg-danger px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white">
          {badge}
        </span>
      )}
    </button>
  );
}
