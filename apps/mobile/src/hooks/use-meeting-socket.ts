import { useEffect, useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { WS_EVENTS, type ChatMessagePayload, type ParticipantPresencePayload } from '@arutech/types';
import { getSocket, disconnectSocket } from '../lib/socket';

export interface ModerationEvent {
  type: 'mute' | 'camera_disable' | 'remove' | 'role_change';
  participantId: string;
  role?: string;
}

/**
 * Mobile port of apps/web/src/hooks/use-meeting-socket.ts — same event contract
 * (packages/types/src/websocket-events.ts) and the same division of
 * responsibility: this owns chat/presence/moderation over Socket.IO, never
 * audio/video (that's MeetingRoomScreen's LiveKit Room connection).
 */
export function useMeetingSocket(meetingId: string | null, accessToken: string | null) {
  const socketRef = useRef<Socket | null>(null);
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

    const onConnect = () => socket.emit(WS_EVENTS.JOIN_MEETING, { meetingId });
    const onParticipantJoined = (p: ParticipantPresencePayload) =>
      setParticipants((prev) => [...prev.filter((x) => x.participantId !== p.participantId), p]);
    const onParticipantLeft = (p: { userId: string }) =>
      setParticipants((prev) => prev.filter((x) => x.userId !== p.userId));
    const onChatMessage = (m: ChatMessagePayload) => setMessages((prev) => [...prev, m]);
    const onMute = (p: { participantId: string }) =>
      setLastModeration({ type: 'mute', participantId: p.participantId });
    const onCameraDisable = (p: { participantId: string }) =>
      setLastModeration({ type: 'camera_disable', participantId: p.participantId });
    const onRemove = (p: { participantId: string }) =>
      setLastModeration({ type: 'remove', participantId: p.participantId });
    const onRoleChange = (p: { participantId: string; role: string }) =>
      setLastModeration({ type: 'role_change', participantId: p.participantId, role: p.role });
    const onMeetingEnded = () => setMeetingEnded(true);
    const onWaitingRoomAdmit = (p: { participantId: string }) => setWaitingAdmitted(p.participantId);
    const onWaitingRoomJoined = () => setWaitingRoomCount((c) => c + 1);

    socket.on('connect', onConnect);
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
      socket.off('connect', onConnect);
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
      disconnectSocket();
    };
  }, [meetingId, accessToken]);

  const sendMessage = useCallback(
    (body: string) => {
      if (!meetingId) return;
      socketRef.current?.emit(WS_EVENTS.CHAT_MESSAGE, { meetingId, body, isPrivate: false });
    },
    [meetingId],
  );

  return {
    participants,
    messages,
    lastModeration,
    meetingEnded,
    waitingAdmitted,
    waitingRoomCount,
    sendMessage,
  };
}
