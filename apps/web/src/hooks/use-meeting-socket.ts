"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Socket } from "socket.io-client";
import {
  WS_EVENTS,
  type ChatMessagePayload,
  type ChatReactionEmoji,
  type ParticipantPresencePayload,
  type ReactionEmoji,
  type ReactionPayload,
} from "@arutech/types";
import { getSocket } from "@/lib/socket";
import { apiFetch } from "@/lib/api-client";

export interface ModerationEvent {
  type: "mute" | "camera_disable" | "remove" | "role_change";
  participantId: string;
  role?: string;
}

/** A reaction currently animating over the video grid — auto-removed by
 * FloatingReaction after its animation finishes (see components/meeting/
 * reactions-overlay.tsx). `key` disambiguates the same user reacting twice in
 * quick succession, which would otherwise collide as React list keys. */
export interface ActiveReaction {
  key: string;
  userId: string;
  emoji: ReactionEmoji;
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
  // How many messages the pre-join history fetch below actually loaded —
  // null until that fetch resolves. Exists purely so the caller (MeetingRoom)
  // can tell "the whole backlog that already existed before I joined" apart
  // from "a message that arrived live while I wasn't looking", which is
  // what an unread badge should actually be counting — see its own comment.
  const [historyMessageCount, setHistoryMessageCount] = useState<number | null>(null);
  const [lastModeration, setLastModeration] = useState<ModerationEvent | null>(null);
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [waitingAdmitted, setWaitingAdmitted] = useState<string | null>(null);
  const [waitingRoomCount, setWaitingRoomCount] = useState(0);
  const [reactions, setReactions] = useState<ActiveReaction[]>([]);

  // Loads existing chat history once on entering a meeting — without this,
  // joining an in-progress meeting (or reloading the page) showed only
  // messages sent after that moment, since the WS channel only ever appends
  // live events and nothing previously fetched the REST history endpoint.
  useEffect(() => {
    if (!meetingId || !accessToken) return;
    apiFetch<ChatMessagePayload[]>(`/meetings/${meetingId}/chat/messages`)
      .then((history) => {
        setMessages([...history].reverse()); // history is newest-first
        setHistoryMessageCount(history.length);
      })
      .catch(() => {});
  }, [meetingId, accessToken]);

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
    const onChatReaction = (updated: ChatMessagePayload) =>
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    const onChatMessageDeleted = (p: { messageId: string }) =>
      setMessages((prev) =>
        prev.map((m) =>
          m.id === p.messageId ? { ...m, body: null, deletedAt: new Date().toISOString() } : m,
        ),
      );
    const onChatMessageEdited = (updated: ChatMessagePayload) =>
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    const onMute = (p: { participantId: string }) =>
      setLastModeration({ type: "mute", participantId: p.participantId });
    const onCameraDisable = (p: { participantId: string }) =>
      setLastModeration({ type: "camera_disable", participantId: p.participantId });
    const onRemove = (p: { participantId: string }) =>
      setLastModeration({ type: "remove", participantId: p.participantId });
    const onRoleChange = (p: { participantId: string; role: string }) =>
      setLastModeration({ type: "role_change", participantId: p.participantId, role: p.role });
    const onMeetingEnded = () => setMeetingEnded(true);
    const onWaitingRoomAdmit = (p: { participantId: string }) =>
      setWaitingAdmitted(p.participantId);
    const onWaitingRoomJoined = () => setWaitingRoomCount((c) => c + 1);
    // Merges into the same presence rows ParticipantsPanel already reads
    // `handRaised` off of — previously nothing ever set this field to true, so
    // the raise-hand button had no visible effect anywhere in the UI.
    const onHandRaise = (p: { userId: string }) =>
      setParticipants((prev) =>
        prev.map((x) => (x.userId === p.userId ? { ...x, handRaised: true } : x)),
      );
    const onHandLower = (p: { userId: string }) =>
      setParticipants((prev) =>
        prev.map((x) => (x.userId === p.userId ? { ...x, handRaised: false } : x)),
      );
    const onReaction = (r: ReactionPayload) => {
      const key = `${r.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setReactions((prev) => [...prev, { key, userId: r.userId, emoji: r.emoji }]);
      // Auto-expire after the overlay's animation window (see reactions-overlay.tsx)
      // rather than relying solely on the overlay to call dismissReaction — a
      // stray reaction shouldn't linger in state forever if the overlay ever
      // unmounts mid-animation (e.g. a fast panel switch).
      setTimeout(() => setReactions((prev) => prev.filter((x) => x.key !== key)), 4000);
    };

    socket.on("connect", onConnect);
    socket.on(WS_EVENTS.PARTICIPANT_JOINED, onParticipantJoined);
    socket.on(WS_EVENTS.PARTICIPANT_LEFT, onParticipantLeft);
    socket.on(WS_EVENTS.CHAT_MESSAGE, onChatMessage);
    socket.on(WS_EVENTS.CHAT_REACTION, onChatReaction);
    socket.on(WS_EVENTS.CHAT_MESSAGE_DELETED, onChatMessageDeleted);
    socket.on(WS_EVENTS.CHAT_MESSAGE_EDITED, onChatMessageEdited);
    socket.on(WS_EVENTS.MODERATION_MUTE, onMute);
    socket.on(WS_EVENTS.MODERATION_CAMERA_DISABLE, onCameraDisable);
    socket.on(WS_EVENTS.MODERATION_REMOVE, onRemove);
    socket.on(WS_EVENTS.MODERATION_ROLE_CHANGE, onRoleChange);
    socket.on(WS_EVENTS.MEETING_ENDED, onMeetingEnded);
    socket.on(WS_EVENTS.WAITING_ROOM_ADMIT, onWaitingRoomAdmit);
    socket.on(WS_EVENTS.WAITING_ROOM_JOINED, onWaitingRoomJoined);
    socket.on(WS_EVENTS.HAND_RAISE, onHandRaise);
    socket.on(WS_EVENTS.HAND_LOWER, onHandLower);
    socket.on(WS_EVENTS.REACTION, onReaction);

    if (socket.connected) onConnect();

    return () => {
      socket.emit(WS_EVENTS.LEAVE_MEETING, { meetingId });
      socket.off("connect", onConnect);
      socket.off(WS_EVENTS.PARTICIPANT_JOINED, onParticipantJoined);
      socket.off(WS_EVENTS.PARTICIPANT_LEFT, onParticipantLeft);
      socket.off(WS_EVENTS.CHAT_MESSAGE, onChatMessage);
      socket.off(WS_EVENTS.CHAT_REACTION, onChatReaction);
      socket.off(WS_EVENTS.CHAT_MESSAGE_DELETED, onChatMessageDeleted);
      socket.off(WS_EVENTS.CHAT_MESSAGE_EDITED, onChatMessageEdited);
      socket.off(WS_EVENTS.MODERATION_MUTE, onMute);
      socket.off(WS_EVENTS.MODERATION_CAMERA_DISABLE, onCameraDisable);
      socket.off(WS_EVENTS.MODERATION_REMOVE, onRemove);
      socket.off(WS_EVENTS.MODERATION_ROLE_CHANGE, onRoleChange);
      socket.off(WS_EVENTS.MEETING_ENDED, onMeetingEnded);
      socket.off(WS_EVENTS.WAITING_ROOM_ADMIT, onWaitingRoomAdmit);
      socket.off(WS_EVENTS.WAITING_ROOM_JOINED, onWaitingRoomJoined);
      socket.off(WS_EVENTS.HAND_RAISE, onHandRaise);
      socket.off(WS_EVENTS.HAND_LOWER, onHandLower);
      socket.off(WS_EVENTS.REACTION, onReaction);
      // Deliberately NOT disconnectSocket() here: the underlying connection is
      // an app-level singleton (notifications, team chat) that outlives any
      // one meeting screen — see lib/socket.ts. It's torn down on sign-out
      // instead (useAuthStore.clear()), not on every meeting-leave.
    };
  }, [meetingId, accessToken]);

  const sendMessage = useCallback(
    (
      body: string,
      opts?: { replyToId?: string; isPrivate?: boolean; toUserId?: string; fileId?: string },
    ) => {
      if (!meetingId) return;
      socketRef.current?.emit(WS_EVENTS.CHAT_MESSAGE, {
        meetingId,
        body: body || undefined,
        isPrivate: opts?.isPrivate ?? false,
        replyToId: opts?.replyToId,
        toUserId: opts?.toUserId,
        fileId: opts?.fileId,
      });
    },
    [meetingId],
  );

  const toggleChatReaction = useCallback(
    (messageId: string, emoji: ChatReactionEmoji) => {
      if (!meetingId) return;
      socketRef.current?.emit(WS_EVENTS.CHAT_REACTION, { meetingId, messageId, emoji });
    },
    [meetingId],
  );

  const deleteChatMessage = useCallback(
    async (messageId: string) => {
      if (!meetingId) return;
      await apiFetch(`/meetings/${meetingId}/chat/messages/${messageId}`, { method: "DELETE" });
      // No need to update local state here — the server broadcasts
      // CHAT_MESSAGE_DELETED to the whole room, including this socket.
    },
    [meetingId],
  );

  const editChatMessage = useCallback(
    async (messageId: string, body: string) => {
      if (!meetingId) return;
      await apiFetch(`/meetings/${meetingId}/chat/messages/${messageId}`, {
        method: "PATCH",
        body: JSON.stringify({ body }),
      });
      // Same reasoning as deleteChatMessage — CHAT_MESSAGE_EDITED broadcasts
      // back to this socket too.
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

  /** Host-only: lower another participant's raised hand (see the doc comment
   * on RealtimeGateway.onHandLower — the server independently enforces the
   * capability check, this just triggers it). */
  const lowerHandFor = useCallback(
    (targetUserId: string) => {
      if (!meetingId) return;
      socketRef.current?.emit(WS_EVENTS.HAND_LOWER, { meetingId, targetUserId });
    },
    [meetingId],
  );

  const sendReaction = useCallback(
    (emoji: ReactionEmoji) => {
      if (!meetingId) return;
      socketRef.current?.emit(WS_EVENTS.REACTION, { meetingId, emoji });
    },
    [meetingId],
  );

  const dismissReaction = useCallback((key: string) => {
    setReactions((prev) => prev.filter((x) => x.key !== key));
  }, []);

  return {
    connected,
    participants,
    messages,
    historyMessageCount,
    lastModeration,
    meetingEnded,
    waitingAdmitted,
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
    /** Escape hatch for feature panels (whiteboard, polls, quizzes, breakout
     * rooms) that need their own event subscriptions without growing this hook
     * indefinitely — see components/meeting/classroom/*. Always the same
     * connection this hook manages; do not call .disconnect() on it directly. */
    socket: socketRef.current,
  };
}
