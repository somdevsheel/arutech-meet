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
  onJoinBreakoutRoom,
  onReturnToMain,
  inBreakoutRoom,
}: {
  meetingId: string;
  socket: Socket | null;
  isModerator: boolean;
  onJoinBreakoutRoom: (token: string, url: string, label: string) => void;
  onReturnToMain: () => void;
  inBreakoutRoom: boolean;
}) {
  const [tab, setTab] = useState<Tab>("whiteboard");

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-surface-border text-xs">
        {(["whiteboard", "polls", "quiz", "breakout"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 capitalize ${tab === t ? "border-b-2 border-brand-500 text-white" : "text-ink-muted"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === "whiteboard" && (
          <WhiteboardCanvas meetingId={meetingId} socket={socket} canEdit={true} />
        )}
        {tab === "polls" && <PollsPanel meetingId={meetingId} socket={socket} canCreate={isModerator} />}
        {tab === "quiz" && <QuizPanel meetingId={meetingId} socket={socket} canCreate={isModerator} />}
        {tab === "breakout" && (
          <BreakoutPanel
            meetingId={meetingId}
            socket={socket}
            canManage={isModerator}
            onJoinRoom={onJoinBreakoutRoom}
            onReturnToMain={onReturnToMain}
            inBreakoutRoom={inBreakoutRoom}
          />
        )}
      </div>
    </div>
  );
}
