"use client";

import { useEffect, useState } from "react";
import { LiveKitRoom } from "@livekit/components-react";
import "@livekit/components-styles";
import { WS_EVENTS } from "@arutech/types";
import { VideoGrid } from "./video-grid";
import { MeetingToolbar, type PanelKind } from "./meeting-toolbar";
import { ChatPanel } from "./chat-panel";
import { ParticipantsPanel } from "./participants-panel";
import { WaitingRoomPanel } from "./waiting-room-panel";
import { ClassroomPanel } from "./classroom/classroom-panel";
import { RecordingsPanel } from "./recordings-panel";
import { useMeetingSocket } from "@/hooks/use-meeting-socket";
import { apiFetch } from "@/lib/api-client";

export interface MeetingRoomProps {
  meetingId: string;
  meetingCode: string;
  title: string;
  token: string;
  livekitUrl: string;
  participantId: string;
  role: string;
  userId: string | null;
  accessToken: string | null;
  onLeave: () => void;
}

const MODERATOR_ROLES = new Set(["OWNER", "HOST", "CO_HOST", "TEACHER"]);

const PANEL_TABS: { key: PanelKind; label: string }[] = [
  { key: "participants", label: "Participants" },
  { key: "chat", label: "Chat" },
  { key: "tools", label: "Tools" },
  { key: "recordings", label: "Record" },
];

interface ActiveConnection {
  token: string;
  url: string;
  label: string | null; // null = the main meeting room
}

export function MeetingRoom({
  meetingId,
  meetingCode,
  title,
  token,
  livekitUrl,
  participantId,
  role,
  userId,
  accessToken,
  onLeave,
}: MeetingRoomProps) {
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [conn, setConn] = useState<ActiveConnection>({ token, url: livekitUrl, label: null });
  const [elapsed, setElapsed] = useState(0);
  const [seenChatCount, setSeenChatCount] = useState(0);
  const isModerator = MODERATOR_ROLES.has(role);

  const {
    participants,
    messages,
    lastModeration,
    meetingEnded,
    waitingRoomCount,
    sendMessage,
    socket,
  } = useMeetingSocket(meetingId, accessToken);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Real unread tracking: whatever's arrived since the chat tab was last open.
  useEffect(() => {
    if (panel === "chat") setSeenChatCount(messages.length);
  }, [panel, messages.length]);
  const unreadChatCount = panel === "chat" ? 0 : messages.length - seenChatCount;

  // Reflects whether a recording is currently in progress in the toolbar badge —
  // seeded from the actual recording list (in case one was already running before
  // this client joined) and then kept live via the same broadcast events
  // RecordingsPanel listens to.
  useEffect(() => {
    apiFetch<{ status: string }[]>(`/meetings/${meetingId}/recordings`)
      .then((recordings) => setIsRecording(recordings.some((r) => r.status === "RECORDING")))
      .catch(() => {});
  }, [meetingId]);

  useEffect(() => {
    if (!socket) return;
    const onStarted = () => setIsRecording(true);
    const onStopped = () => setIsRecording(false);
    socket.on(WS_EVENTS.RECORDING_STARTED, onStarted);
    socket.on(WS_EVENTS.RECORDING_STOPPED, onStopped);
    return () => {
      socket.off(WS_EVENTS.RECORDING_STARTED, onStarted);
      socket.off(WS_EVENTS.RECORDING_STOPPED, onStopped);
    };
  }, [socket]);

  if (meetingEnded) {
    return <EndedScreen onLeave={onLeave} />;
  }

  if (lastModeration?.type === "remove" && lastModeration.participantId === participantId) {
    return <RemovedScreen onLeave={onLeave} />;
  }

  async function moderate(action: string, targetParticipantId: string) {
    await apiFetch(`/meetings/${meetingId}/participants/${targetParticipantId}/${action}`, {
      method: "POST",
    });
  }

  function joinBreakoutRoom(breakoutToken: string, breakoutUrl: string, label: string) {
    setConn({ token: breakoutToken, url: breakoutUrl, label });
  }

  function returnToMain() {
    setConn({ token, url: livekitUrl, label: null });
  }

  const timerLabel = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    // `key` forces LiveKitRoom to fully unmount/remount (cleanly disconnecting
    // from whichever LiveKit room it was in) whenever we switch between the main
    // meeting and a breakout room — LiveKitRoom doesn't reconnect on its own if
    // `token`/`serverUrl` change under it.
    <LiveKitRoom
      key={conn.label ?? "main"}
      token={conn.token}
      serverUrl={conn.url}
      connect
      video
      audio
      onDisconnected={conn.label ? returnToMain : onLeave}
      data-lk-theme="default"
      className="flex h-screen flex-col overflow-hidden bg-surface"
    >
      <header className="flex h-14 flex-none items-center justify-between gap-4 border-b border-surface-border px-5">
        <div className="flex items-center gap-2">
          <Pill>
            <span className="h-2.5 w-2.5 rounded-full bg-success" />
            Encrypted
          </Pill>
          {isRecording && (
            <Pill>
              <span className="h-2.5 w-2.5 rounded-full bg-danger" />
              Recording
            </Pill>
          )}
          {conn.label && (
            <Pill>
              <span className="h-2.5 w-2.5 rounded-full bg-warn" />
              Breakout: {conn.label}
            </Pill>
          )}
        </div>
        <div className="min-w-0 text-center">
          <h1 className="truncate text-sm font-semibold text-white">{title}</h1>
          <p className="text-[11px] text-ink-muted">Code: {meetingCode}</p>
        </div>
        <div className="flex items-center justify-end gap-3" style={{ minWidth: 120 }}>
          <span className="font-mono text-[13px] tabular-nums text-ink-muted">{timerLabel}</span>
        </div>
      </header>

      {isModerator && !conn.label && <WaitingRoomPanel meetingId={meetingId} refreshSignal={waitingRoomCount} />}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 p-3">
          <VideoGrid />
        </div>

        {panel && (
          <aside className="flex w-[320px] flex-none flex-col border-l border-surface-border bg-surface-raised">
            <div className="flex gap-1 border-b border-surface-border px-3 pt-3">
              {PANEL_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setPanel(tab.key)}
                  className={`border-b-2 px-1 pb-2.5 text-[13px] font-medium transition ${
                    panel === tab.key
                      ? "border-brand-500 text-white"
                      : "border-transparent text-ink-muted hover:text-ink-2"
                  }`}
                >
                  {tab.label === "Participants" ? `Participants (${participants.length})` : tab.label}
                </button>
              ))}
              <button
                onClick={() => setPanel(null)}
                aria-label="Close panel"
                className="ml-auto mb-2.5 self-start text-ink-muted hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {panel === "participants" && (
                <ParticipantsPanel
                  participants={participants}
                  isModerator={isModerator}
                  onMute={(id) => moderate("mute", id)}
                  onDisableCamera={(id) => moderate("disable-camera", id)}
                  onRemove={(id) => moderate("remove", id)}
                  onPromote={(id) => moderate("promote-co-host", id)}
                />
              )}
              {panel === "chat" && (
                <ChatPanel messages={messages} onSend={sendMessage} currentUserId={userId} />
              )}
              {panel === "tools" && (
                <ClassroomPanel
                  meetingId={meetingId}
                  socket={socket}
                  isModerator={isModerator}
                  onJoinBreakoutRoom={joinBreakoutRoom}
                  onReturnToMain={returnToMain}
                  inBreakoutRoom={Boolean(conn.label)}
                />
              )}
              {panel === "recordings" && (
                <RecordingsPanel meetingId={meetingId} socket={socket} isModerator={isModerator} />
              )}
            </div>
          </aside>
        )}
      </div>

      <MeetingToolbar
        activePanel={panel}
        onTogglePanel={(p) => setPanel((cur) => (cur === p ? null : p))}
        onLeave={onLeave}
        isRecording={isRecording}
        canShareScreen={true}
        participantCount={participants.length}
        unreadChatCount={unreadChatCount}
      />
    </LiveKitRoom>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-md bg-surface-chip px-2.5 py-1.5 text-xs font-medium text-ink-2">
      {children}
    </span>
  );
}

function EndedScreen({ onLeave }: { onLeave: () => void }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 text-white">
      <p className="text-lg">This meeting has ended.</p>
      <button onClick={onLeave} className="rounded-lg bg-brand-500 px-4 py-2 text-sm hover:bg-brand-600">
        Back to dashboard
      </button>
    </div>
  );
}

function RemovedScreen({ onLeave }: { onLeave: () => void }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 text-white">
      <p className="text-lg">The host removed you from this meeting.</p>
      <button onClick={onLeave} className="rounded-lg bg-brand-500 px-4 py-2 text-sm hover:bg-brand-600">
        Back to dashboard
      </button>
    </div>
  );
}
