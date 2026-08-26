"use client";

import { useEffect, useState } from "react";
import { LiveKitRoom } from "@livekit/components-react";
import "@livekit/components-styles";
import { WS_EVENTS, can, type ParticipantRole, type ParticipantPresencePayload } from "@arutech/types";
import { VideoGrid } from "./video-grid";
import { MeetingToolbar, type PanelKind } from "./meeting-toolbar";
import { ChatPanel } from "./chat-panel";
import { ParticipantsPanel } from "./participants-panel";
import { ReportParticipantModal } from "./report-participant-modal";
import { WaitingRoomPanel } from "./waiting-room-panel";
import { ClassroomPanel } from "./classroom/classroom-panel";
import { RecordingsPanel } from "./recordings-panel";
import { MeetingInfoPanel } from "./meeting-info-panel";
import { ReactionsOverlay } from "./reactions-overlay";
import { CaptionBar } from "./caption-bar";
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
  { key: "info", label: "Info" },
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
  const [recordingBanner, setRecordingBanner] = useState(false);
  const [captionsActive, setCaptionsActive] = useState(false);
  const [captionsPending, setCaptionsPending] = useState(false);
  const [captionsHidden, setCaptionsHidden] = useState(false);
  // Which of the three feature-flag-gated features are actually usable for
  // this meeting — real server state (FeatureFlagsService), not a client
  // guess. Controls hidden here still 403 if somehow clicked anyway; this
  // only avoids showing one that would. Defaults to everything enabled
  // while loading, matching the server's own "unconfigured = on" default.
  const [featureFlags, setFeatureFlags] = useState({ WHITEBOARD: true, BREAKOUT_ROOMS: true, LIVE_CAPTIONS: true });
  const [conn, setConn] = useState<ActiveConnection>({ token, url: livekitUrl, label: null });
  const [elapsed, setElapsed] = useState(0);
  const [seenChatCount, setSeenChatCount] = useState(0);
  const [reportingParticipant, setReportingParticipant] = useState<ParticipantPresencePayload | null>(null);
  const [reportSent, setReportSent] = useState(false);
  const isModerator = MODERATOR_ROLES.has(role);
  // Narrower than isModerator on purpose — CO_HOST is a moderator role but
  // doesn't hold `meeting.end` in the permissions matrix (only OWNER/HOST/
  // TEACHER do), and PermissionService enforces that same check server-side
  // (see MeetingsController's POST /:id/end) — this only decides whether to
  // render the button, not whether the action is allowed.
  const canEndMeeting = can(role as ParticipantRole, "meeting.end");
  // Not gated by featureFlags.LIVE_CAPTIONS here on purpose: this only
  // decides whether the *start* control shows. If captions are somehow
  // already running (started before an admin flipped the flag off
  // mid-meeting), captionsActive alone still lets every participant see the
  // real, live hide/show toggle below — the flag only blocks starting a new
  // session, never hides a genuinely active one.
  const canManageCaptions = can(role as ParticipantRole, "captions.manage") && featureFlags.LIVE_CAPTIONS;

  async function endMeeting() {
    try {
      await apiFetch(`/meetings/${meetingId}/end`, { method: "POST" });
    } catch {
      // Ending genuinely failed server-side (network/permission/already-ended)
      // — don't navigate the host away from a meeting that's still running.
      return;
    }
    onLeave();
  }

  const {
    participants,
    messages,
    lastModeration,
    meetingEnded,
    waitingRoomCount,
    reactions,
    sendMessage,
    toggleChatReaction,
    deleteChatMessage,
    editChatMessage,
    raiseHand,
    lowerHandFor,
    sendReaction,
    dismissReaction,
    socket,
  } = useMeetingSocket(meetingId, accessToken);

  // Derived from the server-broadcast presence list, not separate local state,
  // so it stays correct whether the toggle came from this tab or a host
  // force-lowering it via lowerHandFor.
  const myHandRaised = participants.find((p) => p.userId === userId)?.handRaised ?? false;
  function toggleHand() {
    raiseHand(!myHandRaised);
  }

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
  // RecordingsPanel listens to. Joining an already-recording meeting counts as
  // the consent-relevant moment just as much as watching it start live, so the
  // banner below fires here too, not only from the WS event.
  useEffect(() => {
    apiFetch<{ status: string }[]>(`/meetings/${meetingId}/recordings`)
      .then((recordings) => {
        const recording = recordings.some((r) => r.status === "RECORDING");
        setIsRecording(recording);
        if (recording) setRecordingBanner(true);
      })
      .catch(() => {});
  }, [meetingId]);

  // The persistent header pill alone isn't real notice — a participant who
  // wasn't looking at the header the instant it appeared would never actually
  // see recording start. This banner is the explicit, momentary "this meeting
  // is being recorded" every participant gets (auto-dismissing, not blocking),
  // independent of the always-on pill.
  useEffect(() => {
    if (!socket) return;
    const onStarted = () => {
      setIsRecording(true);
      setRecordingBanner(true);
    };
    const onStopped = () => setIsRecording(false);
    socket.on(WS_EVENTS.RECORDING_STARTED, onStarted);
    socket.on(WS_EVENTS.RECORDING_STOPPED, onStopped);
    return () => {
      socket.off(WS_EVENTS.RECORDING_STARTED, onStarted);
      socket.off(WS_EVENTS.RECORDING_STOPPED, onStopped);
    };
  }, [socket]);

  useEffect(() => {
    if (!recordingBanner) return;
    const id = setTimeout(() => setRecordingBanner(false), 8000);
    return () => clearTimeout(id);
  }, [recordingBanner]);

  // Same "seed from real current state, then stay live via broadcast" shape
  // as the recording flag above — a late joiner should see captions are
  // already on rather than only learning it from the next CAPTIONS_STARTED.
  useEffect(() => {
    apiFetch<{ active: boolean }>(`/meetings/${meetingId}/captions/status`)
      .then((r) => setCaptionsActive(r.active))
      .catch(() => {});
  }, [meetingId]);

  useEffect(() => {
    apiFetch<typeof featureFlags>(`/meetings/${meetingId}/feature-flags`)
      .then(setFeatureFlags)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  useEffect(() => {
    if (!socket) return;
    const onStarted = () => setCaptionsActive(true);
    const onStopped = () => setCaptionsActive(false);
    socket.on(WS_EVENTS.CAPTIONS_STARTED, onStarted);
    socket.on(WS_EVENTS.CAPTIONS_STOPPED, onStopped);
    return () => {
      socket.off(WS_EVENTS.CAPTIONS_STARTED, onStarted);
      socket.off(WS_EVENTS.CAPTIONS_STOPPED, onStopped);
    };
  }, [socket]);

  async function toggleCaptions() {
    setCaptionsPending(true);
    try {
      const path = captionsActive ? "stop" : "start";
      const result = await apiFetch<{ active: boolean }>(`/meetings/${meetingId}/captions/${path}`, {
        method: "POST",
      });
      setCaptionsActive(result.active);
    } finally {
      setCaptionsPending(false);
    }
  }

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
        <button
          onClick={() => setPanel((cur) => (cur === "info" ? null : "info"))}
          title="Meeting info"
          className="min-w-0 rounded-lg px-2 py-1 text-center transition hover:bg-surface-field"
        >
          <h1 className="truncate text-sm font-semibold text-white">{title}</h1>
          <p className="text-[11px] text-ink-muted">Code: {meetingCode}</p>
        </button>
        <div className="flex items-center justify-end gap-3" style={{ minWidth: 120 }}>
          <span className="font-mono text-[13px] tabular-nums text-ink-muted">{timerLabel}</span>
        </div>
      </header>

      {isModerator && !conn.label && <WaitingRoomPanel meetingId={meetingId} refreshSignal={waitingRoomCount} />}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div data-video-grid-root className="relative min-h-0 min-w-0 flex-1 p-3">
          <VideoGrid />
          <ReactionsOverlay reactions={reactions} onDismiss={dismissReaction} />
          {captionsActive && !captionsHidden && <CaptionBar onHide={() => setCaptionsHidden(true)} />}
          {recordingBanner && (
            <div
              role="alert"
              className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-lg bg-danger-strong px-4 py-2.5 text-xs font-medium text-white shadow-lg"
            >
              <span className="h-2 w-2 flex-none rounded-full bg-white" />
              This meeting is being recorded.
              <button
                onClick={() => setRecordingBanner(false)}
                aria-label="Dismiss recording notice"
                className="ml-1 flex-none text-white/80 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}
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
              {panel === "info" && (
                <MeetingInfoPanel meetingCode={meetingCode} isRecording={isRecording} />
              )}
              {panel === "participants" && (
                <ParticipantsPanel
                  participants={participants}
                  isModerator={isModerator}
                  currentParticipantId={participantId}
                  onMute={(id) => moderate("mute", id)}
                  onDisableCamera={(id) => moderate("disable-camera", id)}
                  onRemove={(id) => moderate("remove", id)}
                  onBlock={(id) => moderate("block", id)}
                  onPromote={(id) => moderate("promote-co-host", id)}
                  onLowerHand={(targetUserId) => lowerHandFor(targetUserId)}
                  onReport={(p) => setReportingParticipant(p)}
                />
              )}
              {panel === "chat" && (
                <ChatPanel
                  meetingId={meetingId}
                  messages={messages}
                  participants={participants}
                  socket={socket}
                  onSend={sendMessage}
                  onToggleReaction={toggleChatReaction}
                  onDeleteMessage={deleteChatMessage}
                  onEditMessage={editChatMessage}
                  currentUserId={userId}
                  isModerator={isModerator}
                />
              )}
              {panel === "tools" && (
                <ClassroomPanel
                  meetingId={meetingId}
                  socket={socket}
                  isModerator={isModerator}
                  onJoinBreakoutRoom={joinBreakoutRoom}
                  onReturnToMain={returnToMain}
                  inBreakoutRoom={Boolean(conn.label)}
                  featureFlags={featureFlags}
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
        canEndMeeting={canEndMeeting}
        onEndMeeting={endMeeting}
        canManageCaptions={canManageCaptions}
        captionsActive={captionsActive}
        captionsPending={captionsPending}
        captionsHidden={captionsHidden}
        onToggleCaptions={canManageCaptions ? toggleCaptions : () => setCaptionsHidden((v) => !v)}
        isRecording={isRecording}
        canShareScreen={true}
        participantCount={participants.length}
        unreadChatCount={unreadChatCount}
        handRaised={myHandRaised}
        onToggleHand={toggleHand}
        onReact={sendReaction}
      />

      {reportingParticipant && (
        <ReportParticipantModal
          meetingId={meetingId}
          participant={reportingParticipant}
          onClose={() => setReportingParticipant(null)}
          onSubmitted={() => {
            setReportingParticipant(null);
            setReportSent(true);
            setTimeout(() => setReportSent(false), 4000);
          }}
        />
      )}
      {reportSent && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-surface-raised px-4 py-2.5 text-sm text-white shadow-xl">
          Report submitted — an admin will review it.
        </div>
      )}
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
