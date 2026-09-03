"use client";

import { useEffect, useRef, useState } from "react";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import "@livekit/components-styles";
import {
  WS_EVENTS,
  can,
  type ParticipantRole,
  type ParticipantPresencePayload,
} from "@arutech/types";
import { VideoGrid } from "./video-grid";
import { MeetingToolbar, type PanelKind } from "./meeting-toolbar";
import { ChatPanel } from "./chat-panel";
import { ParticipantsPanel } from "./participants-panel";
import { ReportParticipantModal } from "./report-participant-modal";
import { WaitingRoomPanel } from "./waiting-room-panel";
import { ClassroomPanel } from "./classroom/classroom-panel";
import { BreakoutProvider } from "./classroom/breakout-panel";
import { RecordingsPanel } from "./recordings-panel";
import { LocalRecordingProvider } from "./local-recording-control";
import { WhiteboardProvider, WhiteboardCanvas } from "./classroom/whiteboard-canvas";
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
  /** Whichever token authenticates this participant's app-level socket
   * connection — a real access token for a signed-in user, or a meeting-
   * scoped guest token (see lib/guest-session.ts) for a guest. Both are
   * accepted identically by TokenService.verifyAnyToken server-side. */
  authToken: string | null;
  onLeave: () => void;
}

const MODERATOR_ROLES = new Set(["OWNER", "HOST", "CO_HOST", "TEACHER"]);

const PANEL_TABS: { key: PanelKind; label: string }[] = [
  { key: "info", label: "Info" },
  { key: "participants", label: "Participants" },
  { key: "chat", label: "Chat" },
  { key: "tools", label: "Tools" },
  { key: "recordings", label: "Record" },
  // Whiteboard deliberately isn't listed here — it's opened only via its own
  // dedicated button in the bottom toolbar (meeting-toolbar.tsx), not as a
  // tab in this row. `panel` can still be "whiteboard" (set by that button)
  // even though no tab here matches it as active; that's intentional.
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
  authToken,
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
  const [featureFlags, setFeatureFlags] = useState({
    WHITEBOARD: true,
    BREAKOUT_ROOMS: true,
    LIVE_CAPTIONS: true,
  });
  const [conn, setConn] = useState<ActiveConnection>({ token, url: livekitUrl, label: null });
  const [elapsed, setElapsed] = useState(0);
  const [seenChatCount, setSeenChatCount] = useState(0);
  const [reportingParticipant, setReportingParticipant] =
    useState<ParticipantPresencePayload | null>(null);
  const [reportSent, setReportSent] = useState(false);

  const {
    participants,
    messages,
    historyMessageCount,
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
  } = useMeetingSocket(meetingId, authToken);

  // M-7: `role` above is a one-time snapshot from the join response — it
  // never updated when someone (including this participant themselves) was
  // promoted/demoted mid-meeting, so a freshly-promoted co-host couldn't
  // actually use any of the moderator controls this same render is about to
  // gate behind `isModerator`/`can(...)` without leaving and rejoining.
  // `participants` (from useMeetingSocket) already carries this
  // participant's own live row — including role — and now stays correct in
  // real time (see that hook's onRoleChange), so it's the one source of
  // truth for "what can I actually do right now", falling back to the
  // join-time snapshot only for the brief window before that first
  // self-presence event arrives.
  const effectiveRole = participants.find((p) => p.participantId === participantId)?.role ?? role;
  const isModerator = MODERATOR_ROLES.has(effectiveRole);
  // Narrower than isModerator on purpose — CO_HOST is a moderator role but
  // doesn't hold `meeting.end` in the permissions matrix (only OWNER/HOST/
  // TEACHER do), and PermissionService enforces that same check server-side
  // (see MeetingsController's POST /:id/end) — this only decides whether to
  // render the button, not whether the action is allowed.
  const canEndMeeting = can(effectiveRole as ParticipantRole, "meeting.end");
  // Not gated by featureFlags.LIVE_CAPTIONS here on purpose: this only
  // decides whether the *start* control shows. If captions are somehow
  // already running (started before an admin flipped the flag off
  // mid-meeting), captionsActive alone still lets every participant see the
  // real, live hide/show toggle below — the flag only blocks starting a new
  // session, never hides a genuinely active one.
  const canManageCaptions =
    can(effectiveRole as ParticipantRole, "captions.manage") && featureFlags.LIVE_CAPTIONS;
  // Broader than isModerator on purpose, the other direction from
  // canEndMeeting above: whiteboard.edit is granted to STUDENT/PARTICIPANT
  // too, only GUEST lacks it. See ClassroomPanel's own comment on this prop
  // for what breaks if this is hardcoded true instead.
  const canEditWhiteboard = can(effectiveRole as ParticipantRole, "whiteboard.edit");
  // Requested layout: Whiteboard is its own top-level panel (next to Record
  // in the toolbar — see meeting-toolbar.tsx — not nested inside Tools
  // anymore), and whenever it's the open one, it takes the main stage
  // full-size with participant video moved to the side panel instead. No
  // separate manual toggle: switching to any other panel, or closing this
  // one, hands the main stage back to the video grid simply because this
  // stops being true.
  const isWhiteboardOpen = panel === "whiteboard";

  // Opening/closing the whiteboard is otherwise a purely local `panel`
  // toggle — nothing told anyone else it happened, so a host opening it
  // wasn't actually visible to participants at all; they'd stay on
  // whatever panel or video view they already had. This makes it behave
  // like starting a screen share instead: broadcast the transition
  // whenever `panel` crosses into/out of "whiteboard" (covers every way
  // that can happen — the toolbar button, switching straight to another
  // tab while it's open, or closing the panel outright — since they all
  // just change this one piece of state), and force every other client's
  // `panel` to follow, below. Only emitted when this participant can
  // actually edit the whiteboard (server would reject it otherwise) — a
  // viewer-only participant opening it locally to look shouldn't be able
  // to swap everyone else's screen.
  const prevPanelRef = useRef<PanelKind | null>(null);
  useEffect(() => {
    const prev = prevPanelRef.current;
    prevPanelRef.current = panel;
    if (!socket || !canEditWhiteboard) return;
    if (panel === "whiteboard" && prev !== "whiteboard") {
      socket.emit(WS_EVENTS.WHITEBOARD_OPENED, { meetingId });
    } else if (prev === "whiteboard" && panel !== "whiteboard") {
      socket.emit(WS_EVENTS.WHITEBOARD_CLOSED, { meetingId });
    }
  }, [panel, socket, canEditWhiteboard, meetingId]);

  useEffect(() => {
    if (!socket) return;
    const onOpened = () => setPanel("whiteboard");
    // Only snap back if this client was actually following the shared
    // whiteboard view — if they'd already navigated to Chat/Tools/etc.
    // themselves in the meantime, leave them where they are.
    const onClosed = () => setPanel((cur) => (cur === "whiteboard" ? null : cur));
    socket.on(WS_EVENTS.WHITEBOARD_OPENED, onOpened);
    socket.on(WS_EVENTS.WHITEBOARD_CLOSED, onClosed);
    return () => {
      socket.off(WS_EVENTS.WHITEBOARD_OPENED, onOpened);
      socket.off(WS_EVENTS.WHITEBOARD_CLOSED, onClosed);
    };
  }, [socket]);

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

  // Real unread tracking: whatever's arrived since the chat tab was last
  // open. `seenChatCount` starts at 0, but `messages` doesn't — it jumps
  // straight to the full pre-join history's length the moment that REST
  // fetch resolves (useMeetingSocket loads history so joining an
  // in-progress meeting shows past messages at all). Without the baseline
  // effect below, that backlog itself briefly WAS "unread": every message
  // ever sent before you joined, reported as new the instant you arrived.
  // historyMessageCount marks exactly when that history load happens, so
  // seenChatCount can be baselined to it once — only messages that arrive
  // live after that point (a real socket append, not the initial fetch)
  // should ever count as unread.
  const historyBaselineApplied = useRef(false);
  useEffect(() => {
    if (!historyBaselineApplied.current && historyMessageCount !== null) {
      setSeenChatCount(historyMessageCount);
      historyBaselineApplied.current = true;
    }
  }, [historyMessageCount]);
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

  // H-1: a participant's LOCAL recording (LocalRecordingProvider — a
  // browser-only capture, no server Egress row) previously gave everyone
  // else in the meeting zero notice it was happening at all. This banner is
  // that notice, kept visually distinct (amber, "locally recording" wording)
  // from the red "this meeting is being recorded" banner above so the two
  // very different claims — a real server recording that becomes a
  // downloadable file vs. one participant's own on-device capture — are
  // never confused for each other.
  const [localRecordingNotice, setLocalRecordingNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!socket) return;
    const onStarted = (p: { displayName: string }) =>
      setLocalRecordingNotice(`${p.displayName} started a local recording of this meeting.`);
    socket.on(WS_EVENTS.LOCAL_RECORDING_STARTED, onStarted);
    return () => {
      socket.off(WS_EVENTS.LOCAL_RECORDING_STARTED, onStarted);
    };
  }, [socket]);

  useEffect(() => {
    if (!localRecordingNotice) return;
    const id = setTimeout(() => setLocalRecordingNotice(null), 8000);
    return () => clearTimeout(id);
  }, [localRecordingNotice]);

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
    // Also clears any leftover captionsHidden from a previous captions
    // session — otherwise a fresh restart (stop, then start again) renders
    // invisibly by default, forcing a "Show captions" click for a session
    // nobody explicitly hid yet.
    const onStarted = () => {
      setCaptionsActive(true);
      setCaptionsHidden(false);
    };
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
      const result = await apiFetch<{ active: boolean }>(
        `/meetings/${meetingId}/captions/${path}`,
        {
          method: "POST",
        },
      );
      setCaptionsActive(result.active);
    } finally {
      setCaptionsPending(false);
    }
  }

  // H-3: "You were removed" used to flash for ~150ms and then silently
  // auto-navigate away ~200-350ms later — no click, no pause, effectively a
  // silent kick instead of the deliberate "stays until you click Back to
  // dashboard" screen it's meant to be.
  //
  // Root cause (confirmed by instrumenting both channels live, not just
  // reading the code): being removed reaches this client over TWO separate
  // channels that are NOT the same event arriving twice — LiveKit's own
  // real-time signaling forcibly disconnects the room connection almost
  // immediately, firing <LiveKitRoom>'s `onDisconnected` well BEFORE this
  // app's own Socket.IO broadcast (MODERATION_REMOVE, REST -> DB write ->
  // Redis pubsub -> socket emit -> client) arrives to explain WHY and render
  // the actual RemovedScreen below. So `onDisconnected` firing first,
  // instantly calling onLeave(), was never a stale echo of a screen that
  // already committed — it consistently WON the race and navigated away
  // before that screen's own state update had even landed.
  //
  // Fix: don't call onLeave() immediately from onDisconnected. Give the
  // slower, explanatory channel (MODERATION_REMOVE / MEETING_ENDED) a brief
  // grace window to catch up and take over via its own explicit screen —
  // comfortably longer than the ~200-360ms delay actually measured between
  // the two channels. Only fall back to a bare disconnect-triggered
  // navigation if nothing explains it within that window (a genuine
  // unexpected drop, e.g. a real network failure).
  const showingTerminalScreenRef = useRef(false);

  if (meetingEnded) {
    showingTerminalScreenRef.current = true;
    return <EndedScreen onLeave={onLeave} />;
  }

  if (lastModeration?.type === "remove" && lastModeration.participantId === participantId) {
    showingTerminalScreenRef.current = true;
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
    // All three providers wrap `<LiveKitRoom>` from the OUTSIDE, not just
    // the panel-switch conditional inside it — see each one's own comment
    // for why: `<LiveKitRoom key={conn.label ?? "main"}>` deliberately
    // force-remounts (cleanly disconnecting from whichever LiveKit room it
    // was in) whenever a participant joins or leaves a breakout room, since
    // LiveKitRoom doesn't reconnect on its own if `token`/`serverUrl` change
    // under it. None of the three actually depends on LiveKit's own Room
    // context (WhiteboardProvider/BreakoutProvider only need this app's own
    // Socket.IO connection; LocalRecordingProvider captures its own
    // independent mic stream — see its comment), so there's no reason any
    // of them has to live inside that remount boundary and get taken down
    // by it: a recording in progress, unsaved whiteboard edits, and — the
    // whole point of BreakoutProvider being here — actually hearing
    // BREAKOUT_ROOMS_CLOSED while inside a breakout room with some other
    // panel open, must all survive a breakout-room switch exactly like they
    // already survive an ordinary panel switch.
    <LocalRecordingProvider meetingId={meetingId} socket={socket}>
      <WhiteboardProvider meetingId={meetingId} socket={socket}>
        <BreakoutProvider
          meetingId={meetingId}
          socket={socket}
          onJoinRoom={joinBreakoutRoom}
          onReturnToMain={returnToMain}
          inBreakoutRoom={Boolean(conn.label)}
        >
          <LiveKitRoom
            key={conn.label ?? "main"}
            token={conn.token}
            serverUrl={conn.url}
            connect
            video
            audio
            onDisconnected={
              conn.label
                ? returnToMain
                : () => {
                    // See showingTerminalScreenRef's own comment above for
                    // why this waits instead of navigating immediately: the
                    // LiveKit-level disconnect that triggers this callback
                    // reliably arrives before the app's own explanation for
                    // it does, not after.
                    setTimeout(() => {
                      if (!showingTerminalScreenRef.current) onLeave();
                    }, 700);
                  }
            }
            data-lk-theme="default"
            className="flex h-screen flex-col overflow-hidden bg-surface"
          >
            {/* Unconditional and outside the whiteboard/video-grid swap below
                on purpose — see VideoGrid's own doc comment for why this
                used to live inside it and had to move: remote audio would
                otherwise briefly cut out every time the whiteboard opens or
                closes, since VideoGrid itself does unmount/remount as it
                relocates between the main stage and the side panel. */}
            <RoomAudioRenderer />
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
                <p className="truncate text-[11px] text-ink-muted">Code: {meetingCode}</p>
              </button>
              <div className="flex items-center justify-end gap-3" style={{ minWidth: 120 }}>
                <span className="font-mono text-[13px] tabular-nums text-ink-muted">
                  {timerLabel}
                </span>
              </div>
            </header>

            {isModerator && !conn.label && (
              <WaitingRoomPanel meetingId={meetingId} refreshSignal={waitingRoomCount} />
            )}

            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              {/* Requested layout: Whiteboard is its own top-level panel
                  (meeting-toolbar.tsx, next to Record) — when it's open, it
                  takes the main stage full-size and the video grid moves to
                  this panel's side strip instead (see the
                  `panel === "whiteboard" && <VideoGrid />` branch below) —
                  a straight swap of which content occupies which slot.
                  `data-video-grid-root` follows VideoGrid to wherever it
                  currently lives (LocalRecordingProvider's capture loop
                  queries this selector for real `<video>` elements to
                  composite — it must never end up pointed at a div that
                  doesn't actually contain any, which is what a fixed
                  placement here would do the moment this swap happens). */}
              <div
                {...(!isWhiteboardOpen ? { "data-video-grid-root": true } : {})}
                className="relative min-h-0 min-w-0 flex-1 p-3"
              >
                {isWhiteboardOpen ? (
                  <WhiteboardCanvas canEdit={canEditWhiteboard} />
                ) : (
                  <VideoGrid />
                )}
                <ReactionsOverlay reactions={reactions} onDismiss={dismissReaction} />
                {captionsActive && !captionsHidden && (
                  <CaptionBar onHide={() => setCaptionsHidden(true)} />
                )}
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
                {localRecordingNotice && (
                  <div
                    role="alert"
                    className={`absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-lg bg-amber-600 px-4 py-2.5 text-xs font-medium text-white shadow-lg ${
                      recordingBanner ? "top-16" : "top-4"
                    }`}
                  >
                    <span className="h-2 w-2 flex-none rounded-full bg-white" />
                    {localRecordingNotice}
                    <button
                      onClick={() => setLocalRecordingNotice(null)}
                      aria-label="Dismiss local recording notice"
                      className="ml-1 flex-none text-white/80 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              {panel && (
                // Full-screen overlay below `md` (matches AppShell's own
                // mobile breakpoint) — the fixed 320px sidebar this is on
                // desktop otherwise squeezes the main video area down to a
                // barely-visible sliver on a phone-width screen (a 375px
                // viewport minus 320px leaves ~55px for the whole main
                // stage). `md:` reverts to the normal side-by-side panel
                // unchanged. The wrapping flex row above is `relative`
                // specifically so this can anchor to it with `inset-0`.
                //
                // Whiteboard is the one exception: it's not a side panel at
                // all, it's the main stage's own content (isWhiteboardOpen
                // swaps WhiteboardCanvas in below) — this aside only exists
                // for THAT panel to show the video grid alongside it. On
                // mobile there's no room for both at once, and the
                // whiteboard is the reason you opened this in the first
                // place, so it wins: skip the overlay entirely below `md`
                // rather than have it cover the canvas you just asked for.
                <aside
                  className={`${isWhiteboardOpen ? "hidden md:flex" : "flex"} absolute inset-0 z-10 w-full flex-none flex-col border-l border-surface-border bg-surface-raised md:static md:inset-auto md:z-auto md:flex md:w-[320px]`}
                >
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
                        {tab.label === "Participants"
                          ? `Participants (${participants.length})`
                          : tab.label}
                      </button>
                    ))}
                    <button
                      onClick={() => setPanel(null)}
                      aria-label="Close panel"
                      className="mb-2.5 self-start text-ink-muted hover:text-white"
                    >
                      ✕
                    </button>
                  </div>

                  <div
                    className="min-h-0 flex-1 overflow-y-auto"
                    {...(isWhiteboardOpen ? { "data-video-grid-root": true } : {})}
                  >
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
                        featureFlags={featureFlags}
                      />
                    )}
                    {panel === "recordings" && (
                      <RecordingsPanel
                        meetingId={meetingId}
                        socket={socket}
                        isModerator={isModerator}
                      />
                    )}
                    {/* Whiteboard is now its own top-level panel — whenever
                        it's open, the real <WhiteboardCanvas> lives on the
                        main stage instead (see isWhiteboardOpen above), so
                        this side panel shows the compact video grid here
                        the whole time this tab is selected, unconditionally
                        (there's no other state to gate it on anymore). */}
                    {panel === "whiteboard" && <VideoGrid />}
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
              onToggleCaptions={
                // Re-showing your own hidden captions always wins, moderator
                // or not — see the matching comment on this button's label
                // in meeting-toolbar.tsx for why: otherwise a moderator who
                // hid their local view has no way back except this same
                // button, which for them means "Stop captions" and ends the
                // live session for everyone just to get their own view back.
                captionsActive && captionsHidden
                  ? () => setCaptionsHidden(false)
                  : canManageCaptions
                    ? toggleCaptions
                    : () => setCaptionsHidden(true)
              }
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
        </BreakoutProvider>
      </WhiteboardProvider>
    </LocalRecordingProvider>
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
      <button
        onClick={onLeave}
        className="rounded-lg bg-brand-500 px-4 py-2 text-sm hover:bg-brand-600"
      >
        Back to dashboard
      </button>
    </div>
  );
}

function RemovedScreen({ onLeave }: { onLeave: () => void }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 text-white">
      <p className="text-lg">The host removed you from this meeting.</p>
      <button
        onClick={onLeave}
        className="rounded-lg bg-brand-500 px-4 py-2 text-sm hover:bg-brand-600"
      >
        Back to dashboard
      </button>
    </div>
  );
}
