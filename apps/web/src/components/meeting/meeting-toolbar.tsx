"use client";

import { useLocalParticipant } from "@livekit/components-react";
import { useEffect, useRef, useState } from "react";
import { REACTION_EMOJIS, type ReactionEmoji } from "@arutech/types";
import { VirtualBackgroundPanel } from "./virtual-background-panel";
import { useVirtualBackground } from "@/hooks/use-virtual-background";

export type PanelKind = "participants" | "chat" | "tools" | "recordings" | "info" | "whiteboard";

interface Props {
  activePanel: PanelKind | null;
  onTogglePanel: (panel: PanelKind) => void;
  onLeave: () => void;
  canEndMeeting: boolean;
  onEndMeeting: () => void;
  canManageCaptions: boolean;
  captionsActive: boolean;
  captionsPending: boolean;
  captionsHidden: boolean;
  onToggleCaptions: () => void;
  isRecording: boolean;
  canShareScreen: boolean;
  /** Only meaningful while `!canShareScreen` — see SCREEN_SHARE_REQUESTED's
   * doc comment in websocket-events.ts for the full request/approve/deny
   * flow this drives. "idle": show "Request to share screen". "pending":
   * request sent, waiting on a moderator. "denied": a moderator said no —
   * transient, reverts to "idle" on its own after a few seconds. */
  screenShareRequestState: "idle" | "pending" | "denied";
  onRequestScreenShare: () => void;
  participantCount: number;
  unreadChatCount: number;
  handRaised: boolean;
  onToggleHand: () => void;
  onReact: (emoji: ReactionEmoji) => void;
}

/** Custom toolbar (not LiveKit's prebuilt ControlBar) so the room has its own visual
 * identity per the product's design system, while still driving the same real
 * LiveKit local-participant APIs underneath. */
export function MeetingToolbar({
  activePanel,
  onTogglePanel,
  onLeave,
  canEndMeeting,
  onEndMeeting,
  canManageCaptions,
  captionsActive,
  captionsPending,
  captionsHidden,
  onToggleCaptions,
  isRecording,
  canShareScreen,
  screenShareRequestState,
  onRequestScreenShare,
  participantCount,
  unreadChatCount,
  handRaised,
  onToggleHand,
  onReact,
}: Props) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant();
  const [busy, setBusy] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  // Drives the mobile-only scroll-hint fade below — only actually shown
  // while there's real content still off to the right, so it doesn't sit
  // there implying more controls exist once you've already scrolled all the
  // way to Captions. Starts true (most phones open with everything
  // scrolled to the start, i.e. something IS cut off) and gets corrected by
  // the first real measurement a moment after mount.
  const [hasMoreControlsToScroll, setHasMoreControlsToScroll] = useState(true);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setHasMoreControlsToScroll(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    update();
    el.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  // Called here rather than inside VirtualBackgroundPanel itself: that panel
  // only exists in the DOM while its popover is open, so `mode`/`imagePath`/
  // the processor ref all used to live and die with every open/close — the
  // popover looked like it had reset to "None" on reopen even though the
  // actual background effect was still genuinely running on the track the
  // whole time (only the *display* of which button should be highlighted
  // was wrong, not the effect itself). MeetingToolbar stays mounted for the
  // life of the LiveKit connection, so this survives the popover toggling.
  const virtualBackground = useVirtualBackground();
  // Ending a meeting disconnects every participant, not just the host — a
  // much bigger blast radius than any other button on this bar, and there's
  // no confirm-dialog pattern anywhere else in this app to reuse. Arm on the
  // first click (button re-labels itself, auto-disarms after a few seconds),
  // only actually end it on the second.
  const [endArmed, setEndArmed] = useState(false);

  function handleEndClick() {
    if (!endArmed) {
      setEndArmed(true);
      setTimeout(() => setEndArmed(false), 4000);
      return;
    }
    setEndArmed(false);
    onEndMeeting();
  }

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
    // Every control between Mute and Captions can genuinely outgrow a phone-
    // width screen (mic/cam/background + hand/react/participants/chat/share/
    // record/whiteboard/tools/captions is 9-12 buttons at once) — on desktop
    // that's fine at `justify-between` width, but on mobile it used to just
    // silently clip past the visible edge with no way to scroll to it,
    // making Whiteboard/Tools/Captions — and worse, End meeting/Leave —
    // completely unreachable. Both control groups now scroll together as one
    // unit (`overflow-x-auto`); End meeting/Leave stay `flex-none` outside
    // that scroller so the one action you always need is never the part
    // that's hidden.
    <footer className="flex h-20 flex-none items-center gap-2 border-t border-surface-border bg-surface-raised pl-3 pr-3 md:justify-between md:gap-4 md:px-6">
      {/* The scroll itself was the fix above — this wrapper is a second,
          separate fix: swiping a row of icons with no visual hint it
          scrolls doesn't read as "more controls over here," it reads as a
          layout bug (a button's label cut off mid-word at the edge). The
          fade + chevron make the affordance actually visible, mobile only. */}
      <div className="relative min-w-0 flex-1 md:flex-none">
        <div
          ref={scrollerRef}
          className="flex items-center gap-3 overflow-x-auto pr-7 md:gap-4 md:overflow-visible md:pr-0"
        >
      <div className="flex flex-none items-center gap-1.5">
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
        <div className="relative flex-none">
          <Control
            label="Background"
            active={backgroundOpen}
            onClick={() => setBackgroundOpen((v) => !v)}
          >
            <path d="M4 16V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10M4 16l4.5-5 3 3L16 9l4 4M4 16h16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2Z" />
          </Control>
          {backgroundOpen && (
            <div className="absolute bottom-full left-0 mb-2">
              <VirtualBackgroundPanel
                onClose={() => setBackgroundOpen(false)}
                {...virtualBackground}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-none items-center gap-1.5">
        <Control
          label={handRaised ? "Lower hand" : "Raise hand"}
          active={handRaised}
          onClick={onToggleHand}
        >
          <path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11.5V6a1.5 1.5 0 0 1 3 0v8c0 3.3-2.7 6-6 6h-1a6 6 0 0 1-5-2.7L3 13.5a1.4 1.4 0 0 1 2.2-1.7L8 15" />
        </Control>
        <div className="relative flex-none">
          <Control label="React" active={reactionsOpen} onClick={() => setReactionsOpen((v) => !v)}>
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 10.5h.01M15.5 10.5h.01M8 14.5c.9 1.2 2.3 2 4 2s3.1-.8 4-2" />
          </Control>
          {reactionsOpen && (
            <div
              className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 gap-1 rounded-xl border border-surface-border bg-surface-raised p-1.5 shadow-lg"
              onMouseLeave={() => setReactionsOpen(false)}
            >
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    onReact(emoji);
                    setReactionsOpen(false);
                  }}
                  className="grid h-9 w-9 place-items-center rounded-lg text-xl transition hover:bg-surface-field"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
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
        {canShareScreen ? (
          <button
            onClick={() => toggle("screen")}
            disabled={busy}
            className={`flex flex-none flex-col items-center gap-1.5 rounded-lg px-4 py-1.5 text-[11px] font-semibold transition disabled:opacity-50 ${
              isScreenShareEnabled
                ? "bg-success text-white"
                : "bg-success-bg text-success hover:brightness-110"
            }`}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <rect x="3" y="4" width="18" height="13" rx="2" />
              <path d="M12 13V7m0 0-2.5 2.5M12 7l2.5 2.5M8 21h8" />
            </svg>
            {isScreenShareEnabled ? "Stop sharing" : "Share screen"}
          </button>
        ) : (
          // No `screen_share.self` yet (a plain PARTICIPANT/STUDENT/GUEST,
          // outside the rare screenShareScope: ALL_PARTICIPANTS case — see
          // MeetingsService.computeCanShareScreen) — offer to ask a
          // moderator instead of hiding screen share entirely. Once
          // approved this whole branch stops rendering (canShareScreen
          // flips true) and the real Share screen button above takes over;
          // that next click is what actually opens the OS picker, not this
          // one — see SCREEN_SHARE_REQUESTED's doc comment for why it can't
          // happen automatically the moment approval arrives.
          <button
            onClick={onRequestScreenShare}
            disabled={screenShareRequestState === "pending"}
            className={`flex flex-none flex-col items-center gap-1.5 rounded-lg px-4 py-1.5 text-[11px] font-semibold transition disabled:opacity-50 ${
              screenShareRequestState === "denied"
                ? "bg-danger/10 text-danger"
                : "bg-surface-chip text-ink-2 hover:brightness-110"
            }`}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <rect x="3" y="4" width="18" height="13" rx="2" />
              <path d="M12 13V7m0 0-2.5 2.5M12 7l2.5 2.5M8 21h8" />
            </svg>
            {screenShareRequestState === "pending"
              ? "Requesting…"
              : screenShareRequestState === "denied"
                ? "Request denied"
                : "Request to share screen"}
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
        {/* A direct, top-level entry point next to Record — previously
            Whiteboard was two levels deep (open Tools, then pick the
            Whiteboard sub-tab among Polls/Quiz/Breakout), which buried a
            frequently-used feature behind an unrelated one. */}
        <Control
          label="Whiteboard"
          active={activePanel === "whiteboard"}
          onClick={() => onTogglePanel("whiteboard")}
        >
          <path d="M4 4h16v12H4z" />
          <path d="M9 20h6M12 16v4M7 8l3 3 2-2 3 3" />
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
        {(canManageCaptions || captionsActive) && (
          <Control
            label={
              captionsPending
                ? "…"
                : // Re-showing your own hidden captions has to win over the
                  // moderator's manage-session branch below, or a moderator
                  // who hides their local caption bar (CaptionBar's own
                  // "Hide captions" link) has no way back except this same
                  // button — which for them means "Stop captions", ending
                  // the live session for every participant just to get
                  // their own view back. Hidden-and-active means the
                  // session is still running; showing it again is always
                  // just a local toggle, moderator or not.
                  captionsActive && captionsHidden
                  ? "Show captions"
                  : canManageCaptions
                    ? captionsActive
                      ? "Stop captions"
                      : "Captions"
                    : "Hide captions"
            }
            active={captionsActive && !captionsHidden}
            accentActive={canManageCaptions && captionsActive}
            disabled={captionsPending}
            onClick={onToggleCaptions}
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M7.5 11.5a2 2 0 1 1 0 3.2M13.5 11.5a2 2 0 1 1 0 3.2" />
          </Control>
        )}
      </div>
        </div>
        {hasMoreControlsToScroll && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 flex w-7 items-center justify-end bg-gradient-to-l from-surface-raised to-transparent md:hidden"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-ink-3">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </div>
        )}
      </div>

      <div className="flex flex-none items-center gap-2">
        {canEndMeeting && (
          <button
            onClick={handleEndClick}
            className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition hover:brightness-110 ${
              endArmed ? "bg-danger text-white" : "bg-surface-chip text-ink-2 hover:text-white"
            }`}
          >
            {endArmed ? "Click again to end for everyone" : "End meeting"}
          </button>
        )}
        <button
          onClick={onLeave}
          className="rounded-lg bg-danger-strong px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Leave
        </button>
      </div>
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
      className={`relative flex flex-none flex-col items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
        active ? "bg-surface-field text-white" : "text-ink-3 hover:bg-surface-field"
      }`}
    >
      <span className={off ? "text-danger" : accentActive ? "text-danger" : ""}>
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
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
