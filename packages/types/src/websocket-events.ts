/**
 * Shared Socket.IO event name constants and payload types for the app-level
 * realtime channel (chat, presence, moderation, whiteboard/poll/quiz sync).
 * WebRTC media itself does NOT go over this channel — see docs/webrtc.md.
 */

export const WS_EVENTS = {
  // Connection lifecycle
  JOIN_MEETING: "meeting:join",
  LEAVE_MEETING: "meeting:leave",
  MEETING_ENDED: "meeting:ended",

  // Participants
  PARTICIPANT_JOINED: "participant:joined",
  PARTICIPANT_LEFT: "participant:left",
  PARTICIPANT_UPDATED: "participant:updated",

  // Moderation (server enforces via PermissionService before emitting/acting)
  MODERATION_MUTE: "moderation:mute",
  MODERATION_REMOVE: "moderation:remove",
  MODERATION_CAMERA_DISABLE: "moderation:camera_disable",
  MODERATION_ROLE_CHANGE: "moderation:role_change",
  MODERATION_LOCK_MEETING: "moderation:lock_meeting",

  // Waiting room
  WAITING_ROOM_JOINED: "waiting_room:joined",
  WAITING_ROOM_ADMIT: "waiting_room:admit",
  WAITING_ROOM_DENY: "waiting_room:deny",

  // Hand raise
  HAND_RAISE: "hand:raise",
  HAND_LOWER: "hand:lower",

  // Chat
  CHAT_MESSAGE: "chat:message",
  CHAT_TYPING: "chat:typing",
  CHAT_REACTION: "chat:reaction",

  // Whiteboard
  WHITEBOARD_OP: "whiteboard:op",
  WHITEBOARD_PAGE_SYNC: "whiteboard:page_sync",

  // Polls / quizzes
  POLL_PUBLISHED: "poll:published",
  POLL_RESPONSE: "poll:response",
  POLL_CLOSED: "poll:closed",
  QUIZ_PUBLISHED: "quiz:published",
  QUIZ_ANSWER: "quiz:answer",
  QUIZ_CLOSED: "quiz:closed",

  // Breakout rooms
  BREAKOUT_ROOMS_CREATED: "breakout:created",
  BREAKOUT_ROOM_ASSIGNED: "breakout:assigned",
  BREAKOUT_BROADCAST: "breakout:broadcast",
  BREAKOUT_ROOMS_CLOSED: "breakout:closed",

  // Attendance
  ATTENDANCE_UPDATED: "attendance:updated",

  // Recording
  RECORDING_STARTED: "recording:started",
  RECORDING_STOPPED: "recording:stopped",
  // Fired on every egress webhook-driven status change (RECORDING -> PROCESSING
  // -> READY/FAILED). RECORDING_STARTED/STOPPED only cover the user-initiated
  // edges of that lifecycle — without this, a client has no way to learn a
  // recording finished processing short of re-opening the panel.
  RECORDING_UPDATED: "recording:updated",

  // Notifications (personal channel — every socket auto-joins `user:{id}` on
  // connect, see RealtimeGateway.handleConnection)
  NOTIFICATION_CREATED: "notification:created",

  // Team chat (standing chat rooms outside any meeting — GROUP/DIRECT
  // ChatRoom types; distinct from CHAT_MESSAGE above, which is meeting-scoped)
  ROOM_JOIN: "room:join",
  ROOM_LEAVE: "room:leave",
  ROOM_MESSAGE: "room:message",

  // Errors
  ERROR: "error",
} as const;

export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

export interface ChatMessagePayload {
  id: string;
  chatRoomId: string;
  senderId: string | null;
  senderName: string;
  body: string;
  replyToId: string | null;
  isPrivate: boolean;
  toUserId: string | null;
  createdAt: string;
}

export interface ParticipantPresencePayload {
  participantId: string;
  userId: string | null;
  displayName: string;
  role: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  isScreenSharing: boolean;
  handRaised: boolean;
}

export interface WhiteboardOpPayload {
  meetingId: string;
  pageIndex: number;
  op: {
    type: "stroke" | "shape" | "text" | "sticky-note" | "erase" | "clear";
    id: string;
    data: Record<string, unknown>;
  };
  fromUserId: string;
}
