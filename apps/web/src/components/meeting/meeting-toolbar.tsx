"use client";

import { useLocalParticipant } from "@livekit/components-react";
import { useState } from "react";

interface Props {
  onToggleChat: () => void;
  onToggleParticipants: () => void;
  onToggleTools: () => void;
  onToggleRecordings: () => void;
  onLeave: () => void;
  chatOpen: boolean;
  participantsOpen: boolean;
  toolsOpen: boolean;
  recordingsOpen: boolean;
  isRecording: boolean;
  canShareScreen: boolean;
}

/** Custom toolbar (not LiveKit's prebuilt ControlBar) so the room has its own visual
 * identity per the product's design system, while still driving the same real
 * LiveKit local-participant APIs underneath. */
export function MeetingToolbar({
  onToggleChat,
  onToggleParticipants,
  onToggleTools,
  onToggleRecordings,
  onLeave,
  chatOpen,
  participantsOpen,
  toolsOpen,
  recordingsOpen,
  isRecording,
  canShareScreen,
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
    <div className="flex items-center justify-center gap-2 border-t border-surface-border bg-surface-raised px-4 py-3">
      <ToolbarButton
        active={isMicrophoneEnabled}
        onClick={() => toggle("mic")}
        disabled={busy}
        label={isMicrophoneEnabled ? "Mute" : "Unmute"}
      />
      <ToolbarButton
        active={isCameraEnabled}
        onClick={() => toggle("cam")}
        disabled={busy}
        label={isCameraEnabled ? "Stop video" : "Start video"}
      />
      {canShareScreen && (
        <ToolbarButton
          active={isScreenShareEnabled}
          onClick={() => toggle("screen")}
          disabled={busy}
          label={isScreenShareEnabled ? "Stop sharing" : "Share screen"}
        />
      )}
      <ToolbarButton active={participantsOpen} onClick={onToggleParticipants} label="Participants" />
      <ToolbarButton active={chatOpen} onClick={onToggleChat} label="Chat" />
      <ToolbarButton active={toolsOpen} onClick={onToggleTools} label="Tools" />
      <ToolbarButton
        active={recordingsOpen}
        onClick={onToggleRecordings}
        label={isRecording ? "● Recording" : "Record"}
      />
      <button
        onClick={onLeave}
        className="ml-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
      >
        Leave
      </button>
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${
        active
          ? "bg-surface-border text-white"
          : "bg-transparent text-slate-400 hover:bg-surface-border/60 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

