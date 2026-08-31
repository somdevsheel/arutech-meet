"use client";

import { useState } from "react";
import type { Socket } from "socket.io-client";
import { WhiteboardCanvas } from "./whiteboard-canvas";
import { PollsPanel } from "./polls-panel";
import { QuizPanel } from "./quiz-panel";
import { BreakoutPanel } from "./breakout-panel";

type Tab = "whiteboard" | "polls" | "quiz" | "breakout";

export function ClassroomPanel({
  meetingId,
  socket,
  isModerator,
  featureFlags,
}: {
  meetingId: string;
  socket: Socket | null;
  isModerator: boolean;
  /** Real server state (FeatureFlagsService), not a client guess — hiding a
   * disabled tab here is UX only, the actual gate is server-side in each of
   * WhiteboardService/BreakoutRoomsService. */
  featureFlags: { WHITEBOARD: boolean; BREAKOUT_ROOMS: boolean };
}) {
  const tabs = (["whiteboard", "polls", "quiz", "breakout"] as Tab[]).filter(
    (t) =>
      (t !== "whiteboard" || featureFlags.WHITEBOARD) &&
      (t !== "breakout" || featureFlags.BREAKOUT_ROOMS),
  );
  const [tab, setTab] = useState<Tab>(tabs[0] ?? "polls");
  const activeTab = tabs.includes(tab) ? tab : (tabs[0] ?? "polls");

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-surface-border text-xs">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 capitalize ${activeTab === t ? "border-b-2 border-brand-500 text-white" : "text-ink-muted"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === "whiteboard" && <WhiteboardCanvas canEdit={true} />}
        {activeTab === "polls" && (
          <PollsPanel meetingId={meetingId} socket={socket} canCreate={isModerator} />
        )}
        {activeTab === "quiz" && (
          <QuizPanel meetingId={meetingId} socket={socket} canCreate={isModerator} />
        )}
        {activeTab === "breakout" && <BreakoutPanel canManage={isModerator} />}
      </div>
    </div>
  );
}
