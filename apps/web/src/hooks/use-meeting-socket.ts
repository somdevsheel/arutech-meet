"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Socket } from "socket.io-client";
import { WS_EVENTS, type ChatMessagePayload, type ParticipantPresencePayload } from "@arutech/types";
import { getSocket } from "@/lib/socket";

export interface ModerationEvent {
  type: "mute" | "camera_disable" | "remove" | "role_change";
  participantId: string;
  role?: string;
}

/**
 * Owns the app-level Socket.IO connection for a single meeting screen: joins the
 * meeting room, tracks presence + chat history in local state, and surfaces
 * moderation/waiting-room events for the UI to react to. This channel carries
 * everything EXCEPT audio/video/screen-share media, which flows directly between
 * the browser and LiveKit (see MeetingRoom's <LiveKitRoom>).
 */
export function useMeetingSocket(meetingId: string | null, accessToken: string | null) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<ParticipantPresencePayload[]>([]);
  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const [lastModeration, setLastModeration] = useState<ModerationEvent | null>(null);
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [waitingAdmitted, setWaitingAdmitted] = useState<string | null>(null);
  const [waitingRoomCount, setWaitingRoomCount] = useState(0);

  useEffect(() => {
    if (!meetingId || !accessToken) return;
    const socket = getSocket(accessToken);
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      socket.emit(WS_EVENTS.JOIN_MEETING, { meetingId });
    };
    const onParticipantJoined = (p: ParticipantPresencePayload) =>
      setParticipants((prev) => [...prev.filter((x) => x.participantId !== p.participantId), p]);
    const onParticipantLeft = (p: { userId: string }) =>
      setParticipants((prev) => prev.filter((x) => x.userId !== p.userId));
    const onChatMessage = (m: ChatMessagePayload) => setMessages((prev) => [...prev, m]);
    const onMute = (p: { participantId: string }) =>
      setLastModeration({ type: "mute", participantId: p.participantId });
    const onCameraDisable = (p: { participantId: string }) =>
      setLastModeration({ type: "camera_disable", participantId: p.participantId });
    const onRemove = (p: { participantId: string }) =>
      setLastModeration({ type: "remove", participantId: p.participantId });
    const onRoleChange = (p: { participantId: string; role: string }) =>
      setLastModeration({ type: "role_change", participantId: p.participantId, role: p.role });
    const onMeetingEnded = () => setMeetingEnded(true);
    const onWaitingRoomAdmit = (p: { participantId: string }) => setWaitingAdmitted(p.participantId);
    const onWaitingRoomJoined = () => setWaitingRoomCount((c) => c + 1);

    socket.on("connect", onConnect);
    socket.on(WS_EVENTS.PARTICIPANT_JOINED, onParticipantJoined);
    socket.on(WS_EVENTS.PARTICIPANT_LEFT, onParticipantLeft);
    socket.on(WS_EVENTS.CHAT_MESSAGE, onChatMessage);
    socket.on(WS_EVENTS.MODERATION_MUTE, onMute);
    socket.on(WS_EVENTS.MODERATION_CAMERA_DISABLE, onCameraDisable);
    socket.on(WS_EVENTS.MODERATION_REMOVE, onRemove);
    socket.on(WS_EVENTS.MODERATION_ROLE_CHANGE, onRoleChange);
    socket.on(WS_EVENTS.MEETING_ENDED, onMeetingEnded);
    socket.on(WS_EVENTS.WAITING_ROOM_ADMIT, onWaitingRoomAdmit);
    socket.on(WS_EVENTS.WAITING_ROOM_JOINED, onWaitingRoomJoined);

    if (socket.connected) onConnect();

    return () => {
      socket.emit(WS_EVENTS.LEAVE_MEETING, { meetingId });
      socket.off("connect", onConnect);
      socket.off(WS_EVENTS.PARTICIPANT_JOINED, onParticipantJoined);
      socket.off(WS_EVENTS.PARTICIPANT_LEFT, onParticipantLeft);
      socket.off(WS_EVENTS.CHAT_MESSAGE, onChatMessage);
      socket.off(WS_EVENTS.MODERATION_MUTE, onMute);
      socket.off(WS_EVENTS.MODERATION_CAMERA_DISABLE, onCameraDisable);
      socket.off(WS_EVENTS.MODERATION_REMOVE, onRemove);
      socket.off(WS_EVENTS.MODERATION_ROLE_CHANGE, onRoleChange);
      socket.off(WS_EVENTS.MEETING_ENDED, onMeetingEnded);
      socket.off(WS_EVENTS.WAITING_ROOM_ADMIT, onWaitingRoomAdmit);
      socket.off(WS_EVENTS.WAITING_ROOM_JOINED, onWaitingRoomJoined);
      // Deliberately NOT disconnectSocket() here: the underlying connection is
      // an app-level singleton (notifications, team chat) that outlives any
      // one meeting screen — see lib/socket.ts. It's torn down on sign-out
      // instead (useAuthStore.clear()), not on every meeting-leave.
    };
  }, [meetingId, accessToken]);

  const sendMessage = useCallback(
    (body: string, opts?: { replyToId?: string; isPrivate?: boolean; toUserId?: string }) => {
      if (!meetingId) return;
      socketRef.current?.emit(WS_EVENTS.CHAT_MESSAGE, {
        meetingId,
        body,
        isPrivate: opts?.isPrivate ?? false,
        replyToId: opts?.replyToId,
        toUserId: opts?.toUserId,
      });
    },
    [meetingId],
  );

  const raiseHand = useCallback(
    (raised: boolean) => {
      if (!meetingId) return;
      socketRef.current?.emit(raised ? WS_EVENTS.HAND_RAISE : WS_EVENTS.HAND_LOWER, { meetingId });
    },
    [meetingId],
  );

  return {
    connected,
    participants,
    messages,
    lastModeration,
    meetingEnded,
    waitingAdmitted,
    waitingRoomCount,
    sendMessage,
    raiseHand,
    /** Escape hatch for feature panels (whiteboard, polls, quizzes, breakout
     * rooms) that need their own event subscriptions without growing this hook
     * indefinitely — see components/meeting/classroom/*. Always the same
     * connection this hook manages; do not call .disconnect() on it directly. */
    socket: socketRef.current,
  };
}
