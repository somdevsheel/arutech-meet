"use client";

import { LiveKitRoom, useLocalParticipant } from "@livekit/components-react";
import "@livekit/components-styles";
import { useEffect, useState } from "react";
import { useCallStore } from "@/lib/call-store";
import { useCallSocket } from "@/hooks/use-call-socket";
import { VideoGrid } from "@/components/meeting/video-grid";

function initialsOf(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

function PeerAvatar({ name, size = 72 }: { name: string; size?: number }) {
  return (
    <span
      className="grid flex-none place-items-center rounded-full bg-brand-500 font-semibold text-white"
      style={{ width: size, height: size, fontSize: size / 2.4 }}
    >
      {initialsOf(name)}
    </span>
  );
}

/**
 * Mounted once, app-wide (see AppShell) — renders whichever call-phase UI
 * applies over the top of whatever page is underneath, the same way a phone's
 * call screen takes over regardless of what app was open. Ringtone-style
 * incoming/outgoing modals are pure UI; the actual "active" phase reuses the
 * exact same `<LiveKitRoom>` + `VideoGrid` the meeting room uses (per the
 * brief's own instruction not to build a second media engine for calls).
 */
export function CallOverlay({ accessToken }: { accessToken: string | null }) {
  useCallSocket(accessToken);
  const { phase, peer, callType, token, url, error, acceptCall, rejectCall, cancelCall, endCall, clearError } =
    useCallStore();

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(clearError, 4000);
    return () => clearTimeout(id);
  }, [error, clearError]);

  if (phase === "active" && token && url) {
    return (
      <LiveKitRoom
        token={token}
        serverUrl={url}
        connect
        video={callType === "VIDEO"}
        audio
        onDisconnected={endCall}
        data-lk-theme="default"
        className="fixed inset-0 z-[100] flex flex-col bg-surface"
      >
        <div className="min-h-0 flex-1 p-3">
          <VideoGrid />
        </div>
        <CallControls peerName={peer?.displayName ?? "Call"} onEnd={endCall} />
      </LiveKitRoom>
    );
  }

  if (phase === "incoming" && peer) {
    return (
      <CallModal>
        <PeerAvatar name={peer.displayName} size={88} />
        <p className="mt-4 text-lg font-semibold text-white">{peer.displayName}</p>
        <p className="mt-1 text-sm text-ink-muted">
          Incoming {callType === "VIDEO" ? "video" : "voice"} call…
        </p>
        <div className="mt-8 flex gap-4">
          <button
            onClick={rejectCall}
            className="grid h-14 w-14 place-items-center rounded-full bg-danger-strong text-white hover:brightness-110"
            aria-label="Decline"
            title="Decline"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 15c4-4.5 12-4.5 16 0M1 12c6-7 16-7 22 0M8.5 18l1.8-1.8a2 2 0 0 1 2.4 0L14.5 18M18 6 6 18" />
            </svg>
          </button>
          <button
            onClick={acceptCall}
            className="grid h-14 w-14 place-items-center rounded-full bg-success text-white hover:brightness-110"
            aria-label="Accept"
            title="Accept"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4.5 3.5c1.3 0 2.5.4 3.5 1.1.4.3.5.8.4 1.3l-.9 2.9c-.1.4 0 .9.4 1.2 1.2 1 2.6 2 4.2 2.7.4.2.9.1 1.2-.2l2.2-2.2c.3-.3.8-.4 1.2-.2.9.4 2 .6 3 .6.6 0 1 .5 1 1v3.3c0 1.1-.9 2-2 2C10.6 20 4 13.4 4 5c0-.8.7-1.5 1.5-1.5Z" />
            </svg>
          </button>
        </div>
      </CallModal>
    );
  }

  if (phase === "outgoing" && peer) {
    return (
      <CallModal>
        <PeerAvatar name={peer.displayName} size={88} />
        <p className="mt-4 text-lg font-semibold text-white">{peer.displayName}</p>
        <p className="mt-1 text-sm text-ink-muted">Calling…</p>
        <button
          onClick={cancelCall}
          className="mt-8 grid h-14 w-14 place-items-center rounded-full bg-danger-strong text-white hover:brightness-110"
          aria-label="Cancel call"
          title="Cancel"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 15c4-4.5 12-4.5 16 0M1 12c6-7 16-7 22 0M8.5 18l1.8-1.8a2 2 0 0 1 2.4 0L14.5 18M18 6 6 18" />
          </svg>
        </button>
      </CallModal>
    );
  }

  if (error) {
    return (
      <div className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-lg bg-surface-raised px-4 py-2.5 text-sm text-white shadow-lg">
        {error}
      </div>
    );
  }

  return null;
}

function CallModal({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/80">
      <div className="flex flex-col items-center rounded-2xl bg-surface-raised px-10 py-8">{children}</div>
    </div>
  );
}

function CallControls({ peerName, onEnd }: { peerName: string; onEnd: () => void }) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const [busy, setBusy] = useState(false);

  async function toggle(kind: "mic" | "cam") {
    setBusy(true);
    try {
      if (kind === "mic") await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
      if (kind === "cam") await localParticipant.setCameraEnabled(!isCameraEnabled);
    } finally {
      setBusy(false);
    }
  }

  return (
    <footer className="flex h-20 flex-none items-center justify-center gap-6 border-t border-surface-border bg-surface-raised px-6">
      <span className="text-sm text-ink-2">{peerName}</span>
      <button
        onClick={() => toggle("mic")}
        disabled={busy}
        className={`grid h-11 w-11 place-items-center rounded-full disabled:opacity-50 ${
          isMicrophoneEnabled ? "bg-surface-chip text-ink-2" : "bg-danger-strong text-white"
        }`}
        aria-label={isMicrophoneEnabled ? "Mute" : "Unmute"}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {isMicrophoneEnabled ? (
            <path d="M9 9V6a3 3 0 0 1 6 0v5a3 3 0 0 1-.05.55M5 11a7 7 0 0 0 10.5 6M12 18v3" />
          ) : (
            <path d="M9 9V6a3 3 0 0 1 6 0v5M5 11a7 7 0 0 0 10.5 6M12 18v3M3 3l18 18" />
          )}
        </svg>
      </button>
      <button
        onClick={() => toggle("cam")}
        disabled={busy}
        className={`grid h-11 w-11 place-items-center rounded-full disabled:opacity-50 ${
          isCameraEnabled ? "bg-surface-chip text-ink-2" : "bg-danger-strong text-white"
        }`}
        aria-label={isCameraEnabled ? "Stop video" : "Start video"}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="6" width="12" height="12" rx="2" />
          <path d="m15 11 6-4v10l-6-4" />
        </svg>
      </button>
      <button
        onClick={onEnd}
        className="rounded-full bg-danger-strong px-6 py-2.5 text-sm font-semibold text-white hover:brightness-110"
      >
        Leave
      </button>
    </footer>
  );
}
