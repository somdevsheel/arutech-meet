import { Inject, Logger, UseFilters } from "@nestjs/common";
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
import { WS_EVENTS, type ParticipantPresencePayload } from "@arutech/types";
import { sendChatMessageSchema } from "@arutech/validation";
import type { Env } from "@arutech/config";
import { TokenService } from "../common/lib/tokens";
import { PermissionService } from "../meetings/permission.service";
import { ChatService } from "../chat/chat.service";
import { WsExceptionFilter } from "./ws-exception.filter";

interface SocketData {
  userId: string;
  email: string;
}

function meetingRoom(meetingId: string): string {
  return `meeting:${meetingId}`;
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
      const payload = this.tokens.verifyAccessToken(token);
      const data: SocketData = { userId: payload.sub, email: payload.email };
      client.data = data;
    } catch {
      client.emit(WS_EVENTS.ERROR, { message: "Invalid or expired token" });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const meetingId = [...client.rooms].find((r) => r.startsWith("meeting:"))?.split(":")[1];
    if (meetingId) {
      this.server.to(meetingRoom(meetingId)).emit(WS_EVENTS.PARTICIPANT_LEFT, {
        userId: (client.data as SocketData)?.userId,
      });
    }
  }

  @SubscribeMessage(WS_EVENTS.JOIN_MEETING)
  async onJoinMeeting(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { meetingId: string },
  ) {
    const { userId } = client.data as SocketData;
    const participant = await this.permissions.getParticipant(body.meetingId, userId);
    if (participant.status !== "ADMITTED" && participant.status !== "JOINED") {
      client.emit(WS_EVENTS.ERROR, { message: "Not admitted to this meeting yet" });
      return;
    }

    await client.join(meetingRoom(body.meetingId));

    const presence: ParticipantPresencePayload = {
      participantId: participant.id,
      userId: participant.userId,
      displayName: client.data.email,
      role: participant.role,
      micEnabled: true,
      cameraEnabled: true,
      isScreenSharing: false,
      handRaised: false,
    };
    this.server.to(meetingRoom(body.meetingId)).emit(WS_EVENTS.PARTICIPANT_JOINED, presence);
  }

  @SubscribeMessage(WS_EVENTS.LEAVE_MEETING)
  async onLeaveMeeting(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { meetingId: string },
  ) {
    await client.leave(meetingRoom(body.meetingId));
    this.server.to(meetingRoom(body.meetingId)).emit(WS_EVENTS.PARTICIPANT_LEFT, {
      userId: (client.data as SocketData).userId,
    });
  }

  @SubscribeMessage(WS_EVENTS.CHAT_MESSAGE)
  async onChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { meetingId: string } & Record<string, unknown>,
  ) {
    const { userId } = client.data as SocketData;
    const dto = sendChatMessageSchema.parse(body);
    const message = await this.chat.persistMessage(body.meetingId, userId, dto);

    const target = dto.isPrivate && dto.toUserId ? [dto.toUserId, userId] : null;
    const payload = {
      id: message.id,
      chatRoomId: message.chatRoomId,
      senderId: message.senderId,
      senderName: message.sender?.displayName ?? "Unknown",
      body: message.body,
      replyToId: message.replyToId,
      isPrivate: message.isPrivate,
      toUserId: message.toUserId,
      createdAt: message.createdAt.toISOString(),
    };

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

  @SubscribeMessage(WS_EVENTS.HAND_RAISE)
  onHandRaise(@ConnectedSocket() client: Socket, @MessageBody() body: { meetingId: string }) {
    this.server.to(meetingRoom(body.meetingId)).emit(WS_EVENTS.HAND_RAISE, {
      userId: (client.data as SocketData).userId,
    });
  }

  @SubscribeMessage(WS_EVENTS.HAND_LOWER)
  onHandLower(@ConnectedSocket() client: Socket, @MessageBody() body: { meetingId: string }) {
    this.server.to(meetingRoom(body.meetingId)).emit(WS_EVENTS.HAND_LOWER, {
      userId: (client.data as SocketData).userId,
    });
  }
}
