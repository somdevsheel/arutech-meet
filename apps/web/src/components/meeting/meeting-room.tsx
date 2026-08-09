"use client";

import { useState } from "react";
import { LiveKitRoom } from "@livekit/components-react";
import "@livekit/components-styles";
import { VideoGrid } from "./video-grid";
import { MeetingToolbar } from "./meeting-toolbar";
import { ChatPanel } from "./chat-panel";
import { ParticipantsPanel } from "./participants-panel";
import { WaitingRoomPanel } from "./waiting-room-panel";
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
  const [chatOpen, setChatOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const isModerator = MODERATOR_ROLES.has(role);

  const {
    participants,
    messages,
    lastModeration,
    meetingEnded,
    waitingRoomCount,
    sendMessage,
  } = useMeetingSocket(meetingId, accessToken);

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

  return (
    <LiveKitRoom
      token={token}
      serverUrl={livekitUrl}
      connect
      video
      audio
      onDisconnected={onLeave}
      data-lk-theme="default"
      className="flex h-screen flex-col bg-surface"
    >
      <header className="flex items-center justify-between border-b border-surface-border px-4 py-3">
        <div>
          <h1 className="text-sm font-medium text-white">{title}</h1>
          <p className="text-xs text-slate-500">Code: {meetingCode}</p>
        </div>
      </header>

      {isModerator && <WaitingRoomPanel meetingId={meetingId} refreshSignal={waitingRoomCount} />}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 p-3">
          <VideoGrid />
        </div>

        {(chatOpen || participantsOpen) && (
          <aside className="w-80 border-l border-surface-border bg-surface-raised">
            {chatOpen && (
              <ChatPanel messages={messages} onSend={sendMessage} currentUserId={userId} />
            )}
            {participantsOpen && (
              <ParticipantsPanel
                participants={participants}
                isModerator={isModerator}
                onMute={(id) => moderate("mute", id)}
                onDisableCamera={(id) => moderate("disable-camera", id)}
                onRemove={(id) => moderate("remove", id)}
                onPromote={(id) => moderate("promote-co-host", id)}
              />
            )}
          </aside>
        )}
      </div>

      <MeetingToolbar
        chatOpen={chatOpen}
        participantsOpen={participantsOpen}
        onToggleChat={() => setChatOpen((v) => !v)}
        onToggleParticipants={() => setParticipantsOpen((v) => !v)}
        onLeave={onLeave}
        canShareScreen={true}
      />
    </LiveKitRoom>
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
