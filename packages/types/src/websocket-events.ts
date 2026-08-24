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

  // Emoji reactions — ephemeral, like hand raise: broadcast-only, never
  // persisted, auto-expire client-side. See RealtimeGateway.onReaction.
  REACTION: "reaction:send",

  // Chat
  CHAT_MESSAGE: "chat:message",
  CHAT_TYPING: "chat:typing",
  // Toggle-and-broadcast: fired with the message's full current reaction list
  // any time one participant adds/removes a reaction, so every open chat
  // panel stays in sync without re-fetching history.
  CHAT_REACTION: "chat:reaction",
  CHAT_MESSAGE_DELETED: "chat:message_deleted",
  CHAT_MESSAGE_EDITED: "chat:message_edited",

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

  // AI meeting assistant — fired on every status change of a MeetingTranscript
  // (PENDING -> PROCESSING -> READY/FAILED), same shape of problem/fix as
  // RECORDING_UPDATED above: transcription runs well after a recording finishes,
  // asynchronously, with no other way for an open panel to learn it completed.
  TRANSCRIPT_UPDATED: "transcript:updated",

  // Notifications (personal channel — every socket auto-joins `user:{id}` on
  // connect, see RealtimeGateway.handleConnection)
  NOTIFICATION_CREATED: "notification:created",

  // Team chat (standing chat rooms outside any meeting — GROUP/DIRECT
  // ChatRoom types; distinct from CHAT_MESSAGE above, which is meeting-scoped)
  ROOM_JOIN: "room:join",
  ROOM_LEAVE: "room:leave",
  ROOM_MESSAGE: "room:message",
  ROOM_MESSAGE_EDITED: "room:message_edited",
  ROOM_MESSAGE_DELETED: "room:message_deleted",
  // Group details (name/photo), membership, or admin changes — a signal to
  // refetch the room, not the full new state (mirrors TRANSCRIPT_UPDATED's
  // shape: cheap, and the client already has a GET to call).
  ROOM_UPDATED: "room:updated",

  // Personal calls (1:1/group, outside any meeting — see apps/api/src/calls).
  // Broadcast-only, always to a `user:{id}` personal room, never a meeting
  // room — CallsService performs the actual state mutation over REST first,
  // these just inform every open client live.
  CALL_INCOMING: "call:incoming",
  CALL_ACCEPTED: "call:accepted",
  CALL_REJECTED: "call:rejected",
  CALL_ENDED: "call:ended",

  // Errors
  ERROR: "error",
} as const;

export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

export interface ChatMessageReactionGroup {
  emoji: string;
  userIds: string[];
}

export interface ChatMessageAttachment {
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: string; // BigInt serializes as string over JSON, same as MeetingRecording.sizeBytes
}

export interface ChatMessagePayload {
  id: string;
  chatRoomId: string;
  senderId: string | null;
  senderName: string;
  /** null once deleted (see CHAT_MESSAGE_DELETED / ChatService.deleteMessage) —
   * the client renders a "Message deleted" placeholder instead of the body. */
  body: string | null;
  replyToId: string | null;
  isPrivate: boolean;
  toUserId: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  /** Set only on a message created via forwarding — see the schema comment
   * on ChatMessage.forwardedFromSenderName for why this is a denormalized
   * name snapshot, not a live reference back to the source message. */
  forwardedFromSenderName: string | null;
  reactions: ChatMessageReactionGroup[];
  attachment: ChatMessageAttachment | null;
}

/** A representative emoji set for chat message reactions — distinct from
 * REACTION_EMOJIS above (those are ephemeral, floating-over-video meeting
 * reactions; these attach permanently to a specific chat message). */
export const CHAT_REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
export type ChatReactionEmoji = (typeof CHAT_REACTION_EMOJIS)[number];

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

export const REACTION_EMOJIS = ["👏", "👍", "❤️", "😂", "🎉", "😕", "🙌"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface ReactionPayload {
  userId: string;
  emoji: ReactionEmoji;
}

export type CallType = "AUDIO" | "VIDEO";

export interface CallUserSummary {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface CallIncomingPayload {
  callId: string;
  type: CallType;
  livekitRoomName: string;
  initiator: CallUserSummary;
}

export interface CallAcceptedPayload {
  callId: string;
  byUserId: string;
}

export interface CallRejectedPayload {
  callId: string;
  byUserId: string;
  /** True when this decline was automatic because the callee already had
   * another call in progress, not a deliberate reject — the UI shows "Busy"
   * instead of "Declined" for this case. */
  busy?: boolean;
}

export interface CallEndedPayload {
  callId: string;
  reason: "ended" | "declined" | "canceled" | "missed";
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
