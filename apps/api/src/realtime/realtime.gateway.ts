import { ForbiddenException, Inject, Logger, UseFilters } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { createAdapter } from "@socket.io/redis-adapter";
import type Redis from "ioredis";
import type { Server, Socket } from "socket.io";
import {
  WS_EVENTS,
  REACTION_EMOJIS,
  CHAT_REACTION_EMOJIS,
  SETTABLE_PRESENCE_STATUSES,
  type ParticipantPresencePayload,
  type ReactionEmoji,
  type ReactionPayload,
  type LocalRecordingPayload,
  type ChatReactionEmoji,
  type SettablePresenceStatus,
  type UserPresenceStatus,
} from "@arutech/types";
import { sendChatMessageSchema, sendRoomChatMessageSchema, whiteboardOpSchema } from "@arutech/validation";
import type { Env } from "@arutech/config";
import { TokenService, isGuestTokenPayload } from "../common/lib/tokens";
import { PermissionService } from "../meetings/permission.service";
import { ChatService } from "../chat/chat.service";
import { WsExceptionFilter } from "./ws-exception.filter";
import { MetricsService } from "../observability/metrics.service";
import { roomBroadcastChannel } from "./realtime-broadcast.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service";
import { PresenceService } from "../presence/presence.service";

interface SocketData {
  userId: string;
  email: string;
  /** True for a meeting guest's socket (see TokenService.GuestTokenPayload) —
   * `userId` above is then their MeetingParticipant.id, not a User.id. Guests
   * have no User row, so anything that touches the `user` table or presence
   * (which is keyed on real accounts) must be skipped for them; they still
   * get the same `userRoom` join so admit/deny broadcasts reach them. */
  isGuest?: boolean;
  /** This socket's own last-broadcast presence, stashed here purely so a
   * participant who joins the meeting LATER can be handed a roster snapshot
   * of everyone already present (see onJoinMeeting) — without this, only
   * participants who join AFTER you would ever appear in your own
   * Participants panel, since PARTICIPANT_JOINED is otherwise only ever
   * broadcast at the moment each participant joins, never replayed. */
  presence?: ParticipantPresencePayload;
  /** The meeting this socket joined (onJoinMeeting), so handleDisconnect can
   * still know which meeting room to notify on an ungraceful disconnect —
   * `client.rooms` is *not* usable there: socket.io empties it via its own
   * internal cleanup before the `disconnect` event fires, so a lookup based
   * on `client.rooms` inside handleDisconnect always sees an empty set
   * (confirmed against socket.io's own source). `client.data` isn't touched
   * by that cleanup, which is exactly why this survives long enough to read
   * here, same as `presence` above already relies on. Cleared again on a
   * graceful onLeaveMeeting so a later disconnect doesn't also emit a
   * redundant second PARTICIPANT_LEFT for a meeting already left cleanly. */
  meetingId?: string;
}

function meetingRoom(meetingId: string): string {
  return `meeting:${meetingId}`;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function chatRoomChannel(chatRoomId: string): string {
  return `chatroom:${chatRoomId}`;
}

/**
 * App-level realtime channel: chat, presence, hand-raise, and the fan-out side of
 * moderation/waiting-room actions triggered via REST (see RealtimeBroadcastService).
 * WebRTC media itself never traverses this gateway — see docs/webrtc.md.
 *
 * Scales horizontally via the Socket.IO Redis adapter (so `server.to(room).emit()`
 * reaches clients connected to any gateway instance) plus a dedicated Redis
 * subscription that bridges REST-originated broadcasts into this instance's sockets.
 */
@UseFilters(WsExceptionFilter)
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly permissions: PermissionService,
    private readonly chat: ChatService,
    private readonly metrics: MetricsService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly presence: PresenceService,
    @Inject("REDIS") private readonly redis: Redis,
    @Inject("ENV") private readonly env: Env,
  ) {}

  async afterInit(server: Server) {
    const pubClient = this.redis.duplicate();
    const subClient = this.redis.duplicate();
    server.adapter(createAdapter(pubClient, subClient));

    // Bridge: REST-triggered broadcasts (RealtimeBroadcastService.publish) arrive here
    // and are fanned out to the relevant meeting room on this gateway instance. The
    // Redis adapter above then propagates `server.to(room).emit()` to every other
    // gateway instance's locally-connected sockets too.
    const bridge = this.redis.duplicate();
    await bridge.psubscribe(`${this.env.REDIS_PREFIX}:meeting:*`);
    bridge.on("pmessage", (_pattern, channel, message) => {
      const meetingId = channel.split(":").pop();
      if (!meetingId) return;
      try {
        const { event, payload } = JSON.parse(message);
        this.server.to(meetingRoom(meetingId)).emit(event, payload);
      } catch (err) {
        this.logger.warn(`Failed to relay broadcast on ${channel}: ${String(err)}`);
      }
    });

    // Second bridge for RealtimeBroadcastService.publishToRoom — unlike the
    // meeting one above, the target room is carried in the message body
    // rather than reconstructed from the channel name, since that
    // reconstruction (split on ":", keep the last segment) silently mangles
    // any room name that isn't a bare meeting id — e.g. `user:{id}` for
    // personal notification delivery.
    const roomBridge = this.redis.duplicate();
    await roomBridge.subscribe(roomBroadcastChannel(this.env));
    roomBridge.on("message", (channel, message) => {
      try {
        const { room, event, payload } = JSON.parse(message);
        this.server.to(room).emit(event, payload);
      } catch (err) {
        this.logger.warn(`Failed to relay room broadcast on ${channel}: ${String(err)}`);
      }
    });

    this.logger.log("RealtimeGateway initialized with Redis adapter + broadcast bridge");
  }

  async handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      client.handshake.headers.authorization?.replace(/^Bearer /, "");
    if (!token) {
      client.emit(WS_EVENTS.ERROR, { message: "Missing auth token" });
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.tokens.verifyAnyToken(token);
      const isGuest = isGuestTokenPayload(payload);
      const data: SocketData = isGuest
        ? { userId: payload.sub, email: "", isGuest: true }
        : { userId: payload.sub, email: payload.email };
      client.data = data;
      // Personal channel every authenticated socket gets for free — used to
      // push notifications (NotificationsService.create) and direct/group
      // team-chat messages (see onJoinChatRoom below) without a per-feature
      // join step, the same way `meeting:{id}` rooms work for meeting events.
      // A guest gets this too (keyed on their MeetingParticipant.id) — it's
      // the only channel ParticipantsService.admit/deny has to reach them on.
      await client.join(userRoom(payload.sub));
      this.metrics.websocketConnections.inc();

      // Everything below this line — lastSeenAt and presence — is keyed on a
      // real User row. A guest has none, so skip it entirely rather than
      // firing updates/broadcasts for an id that isn't a user at all.
      if (isGuest) return;

      // `User.lastSeenAt` — kept as the fallback "last seen X ago" shown once
      // a user is genuinely OFFLINE (see PresenceService). Bumped again in
      // handleDisconnect below so it reflects when they actually left, not
      // just when they last connected.
      void this.prisma.client.user
        .update({ where: { id: payload.sub }, data: { lastSeenAt: new Date() } })
        .catch((err) => this.logger.warn(`Failed to bump lastSeenAt for ${payload.sub}: ${String(err)}`));

      // Real presence (docs/roadmap.md's Presence stage) — a Redis-backed
      // online/away/busy/DND status derived from actually-open sockets, not
      // a recency timestamp. Only broadcast the ONLINE transition when this
      // is genuinely this user's first connected socket (a second tab
      // opening while already online is a no-op, not a fresh "just came
      // online" event).
      const cameOnline = await this.presence.connect(payload.sub, client.id);
      if (cameOnline) await this.broadcastPresence(payload.sub, "ONLINE");
    } catch {
      client.emit(WS_EVENTS.ERROR, { message: "Invalid or expired token" });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const socketData = client.data as SocketData | undefined;
    const userId = socketData?.userId;
    // Only decrement if this socket actually made it through auth (client.data
    // is only ever populated on the success path in handleConnection) — a
    // rejected/unauthenticated socket never incremented the gauge, so
    // unconditionally decrementing here would drift it negative over time
    // (e.g. under a stream of failed connection attempts).
    if (userId) {
      this.metrics.websocketConnections.dec();
      // Guests never ran the presence/lastSeenAt setup in handleConnection —
      // see the isGuest early-return there — so there is nothing to undo here.
      if (!socketData?.isGuest) {
        const wentOffline = await this.presence.disconnect(userId, client.id);
        if (wentOffline) {
          void this.prisma.client.user
            .update({ where: { id: userId }, data: { lastSeenAt: new Date() } })
            .catch((err) => this.logger.warn(`Failed to bump lastSeenAt for ${userId}: ${String(err)}`));
          await this.broadcastPresence(userId, "OFFLINE");
        }
      }
    }
    // `client.rooms` is unusable here — see SocketData.meetingId's doc
    // comment for why this used to silently never fire on anything but a
    // graceful onLeaveMeeting (a closed tab, lost wifi, a sleeping laptop —
    // every real "vanished" case — left every other participant's roster
    // showing someone who was long gone).
    const meetingId = (client.data as SocketData | undefined)?.meetingId;
    if (meetingId) {
      this.server.to(meetingRoom(meetingId)).emit(WS_EVENTS.PARTICIPANT_LEFT, { userId });
    }
  }

  @SubscribeMessage(WS_EVENTS.JOIN_MEETING)
  async onJoinMeeting(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { meetingId: string },
  ) {
    const { userId } = client.data as SocketData;
    // PermissionService.getParticipant now throws for any non-ADMITTED/
    // JOINED status itself (a later, separate fix) — this used to be a
    // plain call followed by an explicit status check right here, emitting
    // this exact friendly message for the everyday "still in the waiting
    // room" case. That check is unreachable now (getParticipant throws
    // before ever returning a WAITING/DENIED/etc. participant), and letting
    // the exception itself bubble up to WsExceptionFilter would replace this
    // specific, expected message with a generic "Something went wrong" for
    // what is a completely normal, common state — not an actual error.
    let participant: Awaited<ReturnType<PermissionService["getParticipant"]>>;
    try {
      participant = await this.permissions.getParticipant(body.meetingId, userId);
    } catch {
      client.emit(WS_EVENTS.ERROR, { message: "Not admitted to this meeting yet" });
      return;
    }

    // Snapshot everyone already in the room BEFORE this socket joins it (and
    // before broadcasting this participant's own presence) — sent only to
    // this joining client, not the room, since everyone else already knows
    // about each other. See the SocketData.presence doc comment for why this
    // is necessary at all.
    const existingSockets = await this.server.in(meetingRoom(body.meetingId)).fetchSockets();
    for (const existing of existingSockets) {
      const existingPresence = (existing.data as SocketData).presence;
      if (existingPresence) client.emit(WS_EVENTS.PARTICIPANT_JOINED, existingPresence);
    }

    await client.join(meetingRoom(body.meetingId));

    // A real display name — not the socket's own email, which every other
    // participant would otherwise see broadcast into their Participants
    // panel for anyone with a real account. Guests have no User row at all,
    // so their own chosen name (already captured as `guestName` at join
    // time) is the only real name available for them.
    const displayName = participant.userId
      ? ((await this.prisma.client.user.findUnique({ where: { id: participant.userId }, select: { displayName: true } }))
          ?.displayName ?? client.data.email)
      : (participant.guestName ?? "Guest");

    const presence: ParticipantPresencePayload = {
      participantId: participant.id,
      userId: participant.userId,
      displayName,
      role: participant.role,
      micEnabled: true,
      cameraEnabled: true,
      isScreenSharing: false,
      handRaised: false,
    };
    (client.data as SocketData).presence = presence;
    // See SocketData.meetingId's doc comment — this is what lets
    // handleDisconnect still know which room to notify on an ungraceful
    // disconnect, since client.rooms is empty by the time that runs.
    (client.data as SocketData).meetingId = body.meetingId;
    this.server.to(meetingRoom(body.meetingId)).emit(WS_EVENTS.PARTICIPANT_JOINED, presence);
  }

  @SubscribeMessage(WS_EVENTS.LEAVE_MEETING)
  async onLeaveMeeting(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { meetingId: string },
  ) {
    await client.leave(meetingRoom(body.meetingId));
    // Cleared so a later full disconnect of this same socket (closing the
    // tab shortly after leaving, say) doesn't also emit a second, redundant
    // PARTICIPANT_LEFT for a meeting this socket already left cleanly.
    const data = client.data as SocketData;
    data.meetingId = undefined;
    data.presence = undefined;
    this.server.to(meetingRoom(body.meetingId)).emit(WS_EVENTS.PARTICIPANT_LEFT, {
      userId: data.userId,
    });
  }

  @SubscribeMessage(WS_EVENTS.CHAT_MESSAGE)
  async onChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { meetingId: string } & Record<string, unknown>,
  ) {
    const { userId } = client.data as SocketData;
    const dto = sendChatMessageSchema.parse(body);
    // Already in wire format (ChatMessagePayload) — ChatService.shapeMessage is
    // the single place that groups reactions/builds the attachment field, used
    // identically by REST history and every WS path.
    const payload = await this.chat.persistMessage(body.meetingId, userId, dto);

    const target = dto.isPrivate && dto.toUserId ? [dto.toUserId, userId] : null;
    if (target) {
      // Private DM: emit only to sockets belonging to the two participants. We look
      // up sockets in the meeting room and filter by attached userId rather than
      // maintaining a separate userId->socket registry.
      const sockets = await this.server.in(meetingRoom(body.meetingId)).fetchSockets();
      for (const s of sockets) {
        if (target.includes((s.data as SocketData).userId)) {
          s.emit(WS_EVENTS.CHAT_MESSAGE, payload);
        }
      }
    } else {
      this.server.to(meetingRoom(body.meetingId)).emit(WS_EVENTS.CHAT_MESSAGE, payload);
    }
  }

  /** Toggles the caller's own reaction on a chat message and broadcasts the
   * message's full updated reaction list to the room — see
   * ChatService.toggleReaction. Reactions aren't private-message-aware (they
   * broadcast to the whole meeting room regardless of whether the message
   * itself was private) since only the two participants of a private message
   * would ever have it rendered to react to in the first place. */
  @SubscribeMessage(WS_EVENTS.CHAT_REACTION)
  async onChatReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { meetingId: string; messageId: string; emoji: string },
  ) {
    if (!CHAT_REACTION_EMOJIS.includes(body.emoji as ChatReactionEmoji)) return;
    const { userId } = client.data as SocketData;
    const payload = await this.chat.toggleReaction(body.meetingId, userId, body.messageId, body.emoji);
    this.server.to(meetingRoom(body.meetingId)).emit(WS_EVENTS.CHAT_REACTION, payload);
  }

  /** Ephemeral, like hand-raise/reactions — never persisted, no capability
   * check (matches how sending a message itself only requires membership).
   * Handles both meeting chat and Team Chat with one handler rather than a
   * second WS_EVENTS constant: exactly one of `meetingId`/`chatRoomId` is
   * ever set, and the client already knows which context it's typing in. */
  @SubscribeMessage(WS_EVENTS.CHAT_TYPING)
  onChatTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { meetingId?: string; chatRoomId?: string; isTyping: boolean },
  ) {
    const { userId } = client.data as SocketData;
    const room = body.meetingId ? meetingRoom(body.meetingId) : body.chatRoomId ? chatRoomChannel(body.chatRoomId) : null;
    if (!room) return;
    client.to(room).emit(WS_EVENTS.CHAT_TYPING, { userId, isTyping: body.isTyping });
  }

  // ── Team chat (standing GROUP/DIRECT rooms) ─────────────────────────────
  // Mirrors the JOIN_MEETING/CHAT_MESSAGE pair above, scoped to a ChatRoom
  // instead of a Meeting — membership (ChatService.requireMember) is the
  // authorization check, there's no capability matrix to consult here.

  @SubscribeMessage(WS_EVENTS.ROOM_JOIN)
  async onJoinChatRoom(@ConnectedSocket() client: Socket, @MessageBody() body: { chatRoomId: string }) {
    const { userId } = client.data as SocketData;
    await this.chat.requireMember(body.chatRoomId, userId);
    await client.join(chatRoomChannel(body.chatRoomId));
  }

  @SubscribeMessage(WS_EVENTS.ROOM_LEAVE)
  async onLeaveChatRoom(@ConnectedSocket() client: Socket, @MessageBody() body: { chatRoomId: string }) {
    await client.leave(chatRoomChannel(body.chatRoomId));
  }

  @SubscribeMessage(WS_EVENTS.ROOM_MESSAGE)
  async onRoomMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { chatRoomId: string } & Record<string, unknown>,
  ) {
    const { userId } = client.data as SocketData;
    const dto = sendRoomChatMessageSchema.parse(body);
    // Already in wire format (ChatMessagePayload, including any attachment)
    // — ChatService.shapeMessage is the single place that builds it, shared
    // with meeting chat and with the REST edit/forward paths.
    const payload = await this.chat.persistRoomMessage(body.chatRoomId, userId, dto);

    // Members who have this room's tab open (joined chatRoomChannel) get it
    // immediately; members who don't still get it via their personal
    // `user:{id}` room, so an unread badge can update even off-screen. Anyone
    // who isn't actively viewing this room right now (not just "offline" —
    // also true for someone on a different page of the app) additionally gets
    // a real, persisted Notification, or a message sent while you're away
    // would otherwise vanish into an unread badge nobody's there to see.
    this.server.to(chatRoomChannel(body.chatRoomId)).emit(WS_EVENTS.ROOM_MESSAGE, payload);
    const viewingSockets = await this.server.in(chatRoomChannel(body.chatRoomId)).fetchSockets();
    const viewingUserIds = new Set(viewingSockets.map((s) => (s.data as SocketData).userId));

    const memberIds = await this.chat.getRoomMemberIds(body.chatRoomId);
    for (const memberId of memberIds) {
      if (memberId === userId) continue;
      this.server.to(userRoom(memberId)).emit(WS_EVENTS.ROOM_MESSAGE, payload);
      if (!viewingUserIds.has(memberId)) {
        await this.notifications.create({
          userId: memberId,
          type: "CHAT_MESSAGE",
          title: `${payload.senderName}`,
          body: payload.body?.slice(0, 140) ?? "",
          data: { chatRoomId: body.chatRoomId },
        });
      }
    }
  }

  @SubscribeMessage(WS_EVENTS.HAND_RAISE)
  onHandRaise(@ConnectedSocket() client: Socket, @MessageBody() body: { meetingId: string }) {
    // Keeps this socket's stashed presence snapshot accurate for anyone who
    // joins later (see onJoinMeeting) — otherwise a hand raised before a
    // third participant joins would silently reset to "not raised" for them.
    const data = client.data as SocketData;
    if (data.presence) data.presence.handRaised = true;
    this.server.to(meetingRoom(body.meetingId)).emit(WS_EVENTS.HAND_RAISE, { userId: data.userId });
  }

  /** `targetUserId` lets a host/co-host lower someone ELSE's hand (spec: host
   * action "Lower hand") — gated behind the same `participant.mute` capability
   * used for other host-only participant controls, since there's no dedicated
   * capability for this and it's the same class of action (host manages
   * another participant's meeting state). Without `targetUserId`, this is the
   * normal self-service path any participant already uses to lower their own hand. */
  @SubscribeMessage(WS_EVENTS.HAND_LOWER)
  async onHandLower(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { meetingId: string; targetUserId?: string },
  ) {
    const { userId } = client.data as SocketData;
    let targetUserId = userId;
    if (body.targetUserId && body.targetUserId !== userId) {
      await this.permissions.requireCapability(body.meetingId, userId, "participant.mute");
      targetUserId = body.targetUserId;
    }

    // Keep whichever socket owns this presence accurate for future joiners
    // (see onJoinMeeting) — the target may be a different socket than the
    // caller's own when a host force-lowers someone else's hand.
    if (targetUserId === userId) {
      const data = client.data as SocketData;
      if (data.presence) data.presence.handRaised = false;
    } else {
      // Best-effort: `fetchSockets()` returns remote-socket snapshots when the
      // target is connected to a different gateway instance (Redis-adapter
      // cluster), and mutating `.data` on those doesn't propagate back to the
      // real socket on its owning instance. Single-instance (today's actual
      // deployment) this is exact; multi-instance it only risks a stale
      // snapshot for a THIRD participant who joins between now and the
      // target's next hand-raise/lower action — never a wrong broadcast to
      // anyone already connected, which uses the room emit below regardless.
      const roomSockets = await this.server.in(meetingRoom(body.meetingId)).fetchSockets();
      const targetSocket = roomSockets.find((s) => (s.data as SocketData).userId === targetUserId);
      if (targetSocket?.data.presence) targetSocket.data.presence.handRaised = false;
    }

    this.server.to(meetingRoom(body.meetingId)).emit(WS_EVENTS.HAND_LOWER, { userId: targetUserId });
  }

  /** Emoji reactions: ephemeral, like hand raise — broadcast to the meeting room
   * and never persisted (the client renders and auto-expires them). Validated
   * against the fixed REACTION_EMOJIS set so this channel can't be used to
   * broadcast arbitrary strings to every other participant's browser. */
  @SubscribeMessage(WS_EVENTS.REACTION)
  onReaction(@ConnectedSocket() client: Socket, @MessageBody() body: { meetingId: string; emoji: string }) {
    if (!REACTION_EMOJIS.includes(body.emoji as ReactionEmoji)) return;
    const payload: ReactionPayload = { userId: (client.data as SocketData).userId, emoji: body.emoji as ReactionEmoji };
    this.server.to(meetingRoom(body.meetingId)).emit(WS_EVENTS.REACTION, payload);
  }

  /** The only signal anyone else in the meeting ever gets that a participant
   * started capturing everyone's video/audio to their own disk —
   * LocalRecordingProvider runs entirely client-side and never touches the
   * API, so without this broadcast nobody else has any way to know it's
   * happening at all. Ephemeral like reactions/hand-raise: not persisted,
   * and deliberately excludes the sender (`client.to`, not `server.to`) —
   * they already have their own "recording" UI state, they don't need a
   * notice about themselves. Trusts the socket's own resolved display name
   * (participant's real name, or a guest's chosen name) rather than
   * anything client-supplied, same as every other presence-derived broadcast
   * here. */
  @SubscribeMessage(WS_EVENTS.LOCAL_RECORDING_STARTED)
  onLocalRecordingStart(@ConnectedSocket() client: Socket, @MessageBody() body: { meetingId: string }) {
    const data = client.data as SocketData;
    const payload: LocalRecordingPayload = { displayName: data.presence?.displayName ?? "A participant" };
    client.to(meetingRoom(body.meetingId)).emit(WS_EVENTS.LOCAL_RECORDING_STARTED, payload);
  }

  @SubscribeMessage(WS_EVENTS.LOCAL_RECORDING_STOPPED)
  onLocalRecordingStop(@ConnectedSocket() client: Socket, @MessageBody() body: { meetingId: string }) {
    const data = client.data as SocketData;
    const payload: LocalRecordingPayload = { displayName: data.presence?.displayName ?? "A participant" };
    client.to(meetingRoom(body.meetingId)).emit(WS_EVENTS.LOCAL_RECORDING_STOPPED, payload);
  }

  /** Live stroke-by-stroke whiteboard sync. High-frequency and ephemeral by
   * design — this does NOT persist to whiteboard_pages on every op (that would
   * be a write per pen-move); the client periodically checkpoints the full page
   * via POST /meetings/:id/whiteboard/pages/save instead (see WhiteboardService).
   * The capability check still runs per-op so a participant without
   * `whiteboard.edit` can't inject draw events even though this channel is
   * otherwise fire-and-forget. */
  @SubscribeMessage(WS_EVENTS.WHITEBOARD_OP)
  async onWhiteboardOp(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: Record<string, unknown>,
  ) {
    const { userId } = client.data as SocketData;
    const dto = whiteboardOpSchema.parse(body);
    await this.permissions.requireCapability(dto.meetingId, userId, "whiteboard.edit");
    if (!(await this.featureFlags.isEnabledForMeeting("WHITEBOARD", dto.meetingId))) {
      throw new ForbiddenException("Whiteboard is disabled for this meeting");
    }

    client.to(meetingRoom(dto.meetingId)).emit(WS_EVENTS.WHITEBOARD_OP, {
      ...dto,
      fromUserId: userId,
    });
  }

  // ── Presence (online/away/busy/DND) ─────────────────────────────────────

  /** Explicit status change — the only client-initiated presence event; ONLINE
   * transitions/OFFLINE are always server-derived from connect/disconnect
   * above, never something a client claims directly. No-ops (silently) if the
   * caller has no connected socket recorded, which shouldn't be reachable
   * from an authenticated socket that's sending this at all, but matches
   * PresenceService.setStatus's own defensive check rather than trusting the
   * gateway's view of "connected" is always in sync with Redis's. */
  @SubscribeMessage(WS_EVENTS.PRESENCE_SET_STATUS)
  async onPresenceSetStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { status: SettablePresenceStatus },
  ) {
    if (!SETTABLE_PRESENCE_STATUSES.includes(body.status)) return;
    const { userId } = client.data as SocketData;
    const applied = await this.presence.setStatus(userId, body.status);
    if (applied) await this.broadcastPresence(userId, body.status);
  }

  /** Keeps this user's presence TTL alive during a long-lived connection with
   * otherwise no other socket traffic — see PresenceService's class doc
   * comment for why a TTL exists here at all (a crashed gateway process, not
   * just a crashed tab). The client emits this on a fixed interval; no reply,
   * no broadcast (status hasn't changed). */
  @SubscribeMessage(WS_EVENTS.PRESENCE_HEARTBEAT)
  async onPresenceHeartbeat(@ConnectedSocket() client: Socket) {
    const { userId } = client.data as SocketData;
    await this.presence.heartbeat(userId);
  }

  /** Fans a presence change out to every chat room this user belongs to
   * (any type — MEETING/CLASS/TEAM/GROUP/DIRECT), the same reach limitation
   * `ROOM_UPDATED` already has: only reaches clients that currently have that
   * room open (joined its `chatroom:{id}` channel via ROOM_JOIN). Contacts
   * page presence is read via polling `GET /presence` instead — see
   * docs/roadmap.md for why that's a deliberate v1 split, not an oversight. */
  private async broadcastPresence(userId: string, status: UserPresenceStatus) {
    const roomIds = await this.chat.getRoomIdsForUser(userId);
    for (const roomId of roomIds) {
      this.server.to(chatRoomChannel(roomId)).emit(WS_EVENTS.PRESENCE_UPDATED, { userId, status });
    }
  }
}
