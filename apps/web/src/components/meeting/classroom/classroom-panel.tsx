"use client";

import { useEffect } from "react";
import type { Socket } from "socket.io-client";
import { WhiteboardCanvas } from "./whiteboard-canvas";
import { PollsPanel } from "./polls-panel";
import { QuizPanel } from "./quiz-panel";
import { BreakoutPanel } from "./breakout-panel";
import { VideoGrid } from "../video-grid";

export type ClassroomTab = "whiteboard" | "polls" | "quiz" | "breakout";

export function ClassroomPanel({
  meetingId,
  socket,
  isModerator,
  canEditWhiteboard,
  featureFlags,
  activeTab,
  onTabChange,
  whiteboardOnMainStage,
}: {
  meetingId: string;
  socket: Socket | null;
  isModerator: boolean;
  /** `can(role, "whiteboard.edit")` from the caller — NOT the same set as
   * isModerator. whiteboard.edit is granted to STUDENT/PARTICIPANT too, only
   * GUEST lacks it, so isModerator would be both wrong (too narrow) and, if
   * this were ever hardcoded true instead, wrong the other way (draws a
   * GUEST a fully interactive-looking toolbar that 403s on every stroke —
   * WhiteboardService/RealtimeGateway already enforce this server-side
   * regardless, so this prop is UX only, but showing live editing controls
   * that silently fail on click is still a real, confusing bug). */
  canEditWhiteboard: boolean;
  /** Real server state (FeatureFlagsService), not a client guess — hiding a
   * disabled tab here is UX only, the actual gate is server-side in each of
   * WhiteboardService/BreakoutRoomsService. */
  featureFlags: { WHITEBOARD: boolean; BREAKOUT_ROOMS: boolean };
  /** Lifted to meeting-room.tsx (rather than owned locally) so it can tell
   * whether the whiteboard is the tab currently on screen, and swap the
   * main stage over to it — see that prop's own doc comment below, and
   * meeting-room.tsx's own comment on the layout swap this drives. */
  activeTab: ClassroomTab;
  onTabChange: (tab: ClassroomTab) => void;
  /** True once meeting-room.tsx has actually swapped the main stage over to
   * the whiteboard (which it only does while this tab is the active one —
   * see `isWhiteboardOpen` there). While true, the real <WhiteboardCanvas>
   * lives on the main stage instead of cramped in this side panel, so this
   * tab's own body shows the participant video grid here instead — the
   * literal swap the person who asked for this described: "whiteboard full
   * size, participants to one side." Switching to any other tab here (or
   * closing the panel) hands the main stage back to the video grid
   * automatically, simply because this stops being the active tab. */
  whiteboardOnMainStage: boolean;
}) {
  const tabs = (["whiteboard", "polls", "quiz", "breakout"] as ClassroomTab[]).filter(
    (t) =>
      (t !== "whiteboard" || featureFlags.WHITEBOARD) &&
      (t !== "breakout" || featureFlags.BREAKOUT_ROOMS),
  );
  // Self-corrects a tab that isn't actually available right now (e.g. the
  // org disabled the Whiteboard feature flag after this was last set) back
  // onto the parent's own state, the same fallback the old locally-owned
  // version of this component always had.
  const correctedTab = tabs.includes(activeTab) ? activeTab : (tabs[0] ?? "polls");
  useEffect(() => {
    if (correctedTab !== activeTab) onTabChange(correctedTab);
  }, [correctedTab, activeTab, onTabChange]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-surface-border text-xs">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            className={`flex-1 py-2 capitalize ${correctedTab === t ? "border-b-2 border-brand-500 text-white" : "text-ink-muted"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {correctedTab === "whiteboard" &&
          (whiteboardOnMainStage ? (
            <VideoGrid />
          ) : (
            <WhiteboardCanvas canEdit={canEditWhiteboard} />
          ))}
        {correctedTab === "polls" && (
          <PollsPanel meetingId={meetingId} socket={socket} canCreate={isModerator} />
        )}
        {correctedTab === "quiz" && (
          <QuizPanel meetingId={meetingId} socket={socket} canCreate={isModerator} />
        )}
        {correctedTab === "breakout" && <BreakoutPanel canManage={isModerator} />}
      </div>
    </div>
  );
}
