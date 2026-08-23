import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { SendChatMessageDto, CreateChatRoomDto, SendRoomChatMessageDto } from "@arutech/validation";
import { WS_EVENTS, type ChatMessagePayload, type ChatMessageReactionGroup } from "@arutech/types";
import { PrismaService } from "../prisma/prisma.service";
import { PermissionService } from "../meetings/permission.service";
import { NotificationsService } from "../notifications/notifications.service";
import { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import { AuditLogService } from "../audit/audit-log.service";
import { ContactsService } from "../contacts/contacts.service";

const MEMBER_SELECT = {
  id: true,
  displayName: true,
  username: true,
  avatarUrl: true,
} as const;

const MESSAGE_INCLUDE = {
  sender: { select: { id: true, displayName: true, avatarUrl: true } },
  reactions: true,
  attachments: { include: { file: true } },
} as const;

type RawMessage = {
  id: string;
  chatRoomId: string;
  senderId: string | null;
  sender: { id: string; displayName: string; avatarUrl: string | null } | null;
  body: string | null;
  replyToId: string | null;
  isPrivate: boolean;
  toUserId: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  reactions: { emoji: string; userId: string }[];
  attachments: { file: { id: string; originalName: string; mimeType: string; sizeBytes: bigint } }[];
};

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly notifications: NotificationsService,
    private readonly broadcast: RealtimeBroadcastService,
    private readonly auditLog: AuditLogService,
    private readonly contacts: ContactsService,
  ) {}

  /** Shapes a raw Prisma row (with MESSAGE_INCLUDE) into the wire format both
   * REST history and every WS broadcast use — keeping these consistent is
   * what lets the client treat a message loaded via `GET .../messages` and
   * one that arrived live over the socket identically. */
  private shapeMessage(message: RawMessage): ChatMessagePayload {
    const reactionGroups = new Map<string, Set<string>>();
    for (const r of message.reactions) {
      if (!reactionGroups.has(r.emoji)) reactionGroups.set(r.emoji, new Set());
      reactionGroups.get(r.emoji)!.add(r.userId);
    }
    const reactions: ChatMessageReactionGroup[] = [...reactionGroups.entries()].map(([emoji, userIds]) => ({
      emoji,
      userIds: [...userIds],
    }));

    const attachment = message.attachments[0]?.file
      ? {
          fileId: message.attachments[0].file.id,
          fileName: message.attachments[0].file.originalName,
          mimeType: message.attachments[0].file.mimeType,
          sizeBytes: message.attachments[0].file.sizeBytes.toString(),
        }
      : null;

    return {
      id: message.id,
      chatRoomId: message.chatRoomId,
      senderId: message.senderId,
      senderName: message.sender?.displayName ?? "Unknown",
      body: message.body,
      replyToId: message.replyToId,
      isPrivate: message.isPrivate,
      toUserId: message.toUserId,
      createdAt: message.createdAt.toISOString(),
      deletedAt: message.deletedAt?.toISOString() ?? null,
      reactions,
      attachment,
    };
  }

  async getMeetingChatRoom(meetingId: string) {
    const room = await this.prisma.client.chatRoom.findUnique({ where: { meetingId } });
    if (!room) throw new NotFoundException("Chat room not found for meeting");
    return room;
  }

  async history(meetingId: string, callerUserId: string, cursor?: string, take = 50) {
    await this.permissions.getParticipant(meetingId, callerUserId);
    const room = await this.getMeetingChatRoom(meetingId);

    const messages = await this.prisma.client.chatMessage.findMany({
      where: {
        chatRoomId: room.id,
        OR: [{ isPrivate: false }, { toUserId: callerUserId }, { senderId: callerUserId }],
      },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return messages.map((m) => this.shapeMessage(m));
  }

  /** Persists a chat message. Called from the WebSocket gateway after it has already
   * verified the sender is a connected, authorized participant for this meeting — this
   * method re-derives the capability check independently rather than trusting the caller. */
  async persistMessage(meetingId: string, senderId: string, dto: SendChatMessageDto): Promise<ChatMessagePayload> {
    const { role } = await this.permissions.requireCapability(meetingId, senderId, "chat.send");
    const meeting = await this.prisma.client.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: { settings: true },
    });
    if (!meeting.settings?.allowChat) {
      throw new ForbiddenException("Chat is disabled for this meeting");
    }
    void role;

    if (dto.fileId) {
      // Prevents attaching a file uploaded by someone else, or one uploaded to a
      // different meeting entirely, to this message.
      const file = await this.prisma.client.fileAsset.findUnique({ where: { id: dto.fileId } });
      if (!file || file.meetingId !== meetingId || file.uploaderUserId !== senderId) {
        throw new BadRequestException("Invalid attachment");
      }
    }

    const room = await this.getMeetingChatRoom(meetingId);
    const message = await this.prisma.client.chatMessage.create({
      data: {
        chatRoomId: room.id,
        senderId,
        body: dto.body,
        replyToId: dto.replyToId,
        isPrivate: dto.isPrivate,
        toUserId: dto.isPrivate ? dto.toUserId : null,
        attachments: dto.fileId ? { create: [{ fileId: dto.fileId }] } : undefined,
      },
      include: MESSAGE_INCLUDE,
    });
    return this.shapeMessage(message);
  }

  /** Toggles the caller's own reaction on/off (unique on messageId+userId+emoji
   * — see schema) and returns the message's full updated reaction list, which
   * the gateway broadcasts to the whole room so every open panel stays in sync
   * without re-fetching. */
  async toggleReaction(meetingId: string, callerUserId: string, messageId: string, emoji: string) {
    await this.permissions.getParticipant(meetingId, callerUserId);
    const message = await this.getMeetingScopedMessage(meetingId, messageId);

    const existing = await this.prisma.client.chatReaction.findUnique({
      where: { messageId_userId_emoji: { messageId, userId: callerUserId, emoji } },
    });
    if (existing) {
      await this.prisma.client.chatReaction.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.client.chatReaction.create({ data: { messageId, userId: callerUserId, emoji } });
    }

    const updated = await this.prisma.client.chatMessage.findUniqueOrThrow({
      where: { id: message.id },
      include: MESSAGE_INCLUDE,
    });
    return this.shapeMessage(updated);
  }

  /** Soft-deletes a message (clears `body`, sets `deletedAt` — the client
   * renders a "Message deleted" placeholder in its place) and broadcasts the
   * deletion live. Own messages need no special permission; deleting someone
   * else's requires `chat.delete_any_message` (host moderation) and is
   * audit-logged, matching every other privileged moderation action in this
   * app (see docs/security.md). */
  async deleteMessage(meetingId: string, callerUserId: string, messageId: string): Promise<void> {
    const message = await this.getMeetingScopedMessage(meetingId, messageId);

    if (message.senderId !== callerUserId) {
      await this.permissions.requireCapability(meetingId, callerUserId, "chat.delete_any_message");
      await this.auditLog.record({
        actorUserId: callerUserId,
        action: "chat.delete_message",
        targetType: "chat_message",
        targetId: messageId,
        metadata: { meetingId, originalSenderId: message.senderId },
      });
    }

    await this.prisma.client.chatMessage.update({
      where: { id: messageId },
      data: { body: null, deletedAt: new Date() },
    });
    await this.broadcast.publish(meetingId, WS_EVENTS.CHAT_MESSAGE_DELETED, { messageId });
  }

  /** Loads a message and confirms it actually belongs to this meeting's chat
   * room — without this, a meeting participant could react to or (attempt to)
   * delete a message from a completely different meeting by guessing/reusing
   * an id, since messageId alone doesn't imply anything about which meeting
   * it came from. */
  private async getMeetingScopedMessage(meetingId: string, messageId: string) {
    const room = await this.getMeetingChatRoom(meetingId);
    const message = await this.prisma.client.chatMessage.findUnique({ where: { id: messageId } });
    if (!message || message.chatRoomId !== room.id) {
      throw new NotFoundException("Message not found");
    }
    return message;
  }

  // ── Standing rooms (Team Chat: GROUP + DIRECT) ──────────────────────────
  // Same ChatRoom/ChatMember/ChatMessage tables the meeting chat above uses
  // (type: GROUP/DIRECT instead of MEETING) — membership itself is the
  // authorization check here (via ChatMember), there's no capability matrix
  // to consult the way meeting chat has (no host, no roles, just members).

  async requireMember(chatRoomId: string, userId: string) {
    const membership = await this.prisma.client.chatMember.findUnique({
      where: { chatRoomId_userId: { chatRoomId, userId } },
    });
    if (!membership) throw new ForbiddenException("Not a member of this chat room");
    return membership;
  }

  listMyRooms(userId: string) {
    return this.prisma.client.chatRoom.findMany({
      where: { members: { some: { userId } }, type: { in: ["GROUP", "DIRECT"] } },
      include: {
        members: { include: { user: { select: MEMBER_SELECT } } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async createRoom(userId: string, dto: CreateChatRoomDto) {
    const memberIds = [...new Set([userId, ...dto.memberUserIds])];

    if (dto.type === "DIRECT") {
      if (memberIds.length !== 2) {
        throw new ForbiddenException("A direct chat is between exactly two people");
      }
      const [a, b] = memberIds as [string, string];
      if (await this.contacts.isBlocked(a, b)) {
        throw new ForbiddenException("You can't message this person");
      }
      // Reuse an existing DIRECT room between this exact pair rather than ever
      // creating a duplicate — same idea as MeetingsService.getOrCreatePersonalRoom.
      const existing = await this.prisma.client.chatRoom.findFirst({
        where: {
          type: "DIRECT",
          AND: memberIds.map((id) => ({ members: { some: { userId: id } } })),
        },
        include: { members: { include: { user: { select: MEMBER_SELECT } } } },
      });
      if (existing) return existing;
    }

    return this.prisma.client.chatRoom.create({
      data: {
        type: dto.type,
        name: dto.type === "GROUP" ? dto.name : null,
        createdById: userId,
        // The creator starts as the group's sole admin — everyone else who
        // manages it later has to be promoted by an existing admin (see
        // promoteAdmin). Meaningless for DIRECT (isAdmin just sits unused).
        members: {
          create: memberIds.map((id) => ({ userId: id, isAdmin: dto.type === "GROUP" && id === userId })),
        },
      },
      include: { members: { include: { user: { select: MEMBER_SELECT } } } },
    });
  }

  /** GROUP rooms only — rename and/or set a photo. Admin-gated: see the
   * class doc comment on why groups need this distinct from meeting-chat's
   * capability matrix (there's no host/role concept here, just member vs.
   * admin, so this is its own small check rather than reusing PermissionService). */
  async updateRoom(chatRoomId: string, userId: string, dto: UpdateChatRoomDto) {
    const room = await this.requireGroupAdmin(chatRoomId, userId);
    return this.prisma.client.chatRoom.update({
      where: { id: room.id },
      data: { name: dto.name, photoUrl: dto.photoUrl },
    });
  }

  async addMember(chatRoomId: string, userId: string, targetUserId: string) {
    const room = await this.requireGroupAdmin(chatRoomId, userId);
    const existing = await this.prisma.client.chatMember.findUnique({
      where: { chatRoomId_userId: { chatRoomId: room.id, userId: targetUserId } },
    });
    if (existing) throw new ConflictException("Already a member of this group");
    return this.prisma.client.chatMember.create({ data: { chatRoomId: room.id, userId: targetUserId } });
  }

  /** Removing yourself is `POST /chat-rooms/:id/leave` (self-service, no
   * admin needed) — this is specifically an admin removing someone else. */
  async removeMember(chatRoomId: string, userId: string, targetUserId: string): Promise<void> {
    const room = await this.requireGroupAdmin(chatRoomId, userId);
    if (targetUserId === userId) {
      throw new BadRequestException("Use leave to remove yourself");
    }
    await this.prisma.client.chatMember.deleteMany({ where: { chatRoomId: room.id, userId: targetUserId } });
  }

  async promoteAdmin(chatRoomId: string, userId: string, targetUserId: string) {
    const room = await this.requireGroupAdmin(chatRoomId, userId);
    const target = await this.prisma.client.chatMember.findUnique({
      where: { chatRoomId_userId: { chatRoomId: room.id, userId: targetUserId } },
    });
    if (!target) throw new NotFoundException("Not a member of this group");
    return this.prisma.client.chatMember.update({ where: { id: target.id }, data: { isAdmin: true } });
  }

  /** Refuses to demote the group's last remaining admin — a group with zero
   * admins would have no way to manage itself again (no one could promote a
   * replacement). */
  async demoteAdmin(chatRoomId: string, userId: string, targetUserId: string) {
    const room = await this.requireGroupAdmin(chatRoomId, userId);
    const target = await this.prisma.client.chatMember.findUnique({
      where: { chatRoomId_userId: { chatRoomId: room.id, userId: targetUserId } },
    });
    if (!target || !target.isAdmin) throw new NotFoundException("Not an admin of this group");

    const adminCount = await this.prisma.client.chatMember.count({ where: { chatRoomId: room.id, isAdmin: true } });
    if (adminCount <= 1) throw new BadRequestException("A group needs at least one admin");

    return this.prisma.client.chatMember.update({ where: { id: target.id }, data: { isAdmin: false } });
  }

  private async requireGroupAdmin(chatRoomId: string, userId: string) {
    const room = await this.prisma.client.chatRoom.findUnique({ where: { id: chatRoomId } });
    if (!room || room.type !== "GROUP") throw new NotFoundException("Group not found");
    const membership = await this.prisma.client.chatMember.findUnique({
      where: { chatRoomId_userId: { chatRoomId, userId } },
    });
    if (!membership?.isAdmin) throw new ForbiddenException("Only a group admin can do that");
    return room;
  }

  async roomHistory(chatRoomId: string, userId: string, cursor?: string, take = 50) {
    await this.requireMember(chatRoomId, userId);
    return this.prisma.client.chatMessage.findMany({
      where: { chatRoomId, deletedAt: null },
      include: { sender: { select: MEMBER_SELECT } },
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  async getRoomMemberIds(chatRoomId: string): Promise<string[]> {
    const members = await this.prisma.client.chatMember.findMany({
      where: { chatRoomId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  async persistRoomMessage(chatRoomId: string, senderId: string, dto: SendRoomChatMessageDto) {
    await this.requireMember(chatRoomId, senderId);
    const message = await this.prisma.client.chatMessage.create({
      data: { chatRoomId, senderId, body: dto.body, replyToId: dto.replyToId },
      include: { sender: { select: MEMBER_SELECT } },
    });
    // The sender has, by definition, read their own message — keeps their own
    // unread badge from lighting up on a room they just posted in.
    await this.prisma.client.chatMember.update({
      where: { chatRoomId_userId: { chatRoomId, userId: senderId } },
      data: { lastReadMessageId: message.id },
    });
    return message;
  }

  /** Leaving a GROUP room just removes your own membership row — the room and
   * its history keep existing for whoever's left. DIRECT rooms aren't
   * leavable (there's no "remove yourself but keep the other person's DM
   * open" concept that makes sense for a 1:1 — same UX call most chat apps make). */
  async leaveRoom(chatRoomId: string, userId: string) {
    const room = await this.prisma.client.chatRoom.findUnique({ where: { id: chatRoomId } });
    if (!room) throw new NotFoundException("Chat room not found");
    if (room.type !== "GROUP") throw new ForbiddenException("Only group chats can be left");
    await this.requireMember(chatRoomId, userId);
    await this.prisma.client.chatMember.delete({
      where: { chatRoomId_userId: { chatRoomId, userId } },
    });
  }

  /** Marks a room read up to its latest message — real read-receipt tracking
   * (ChatMember.lastReadMessageId) rather than a client-side-only "seen" flag,
   * so an unread badge is correct across devices/reloads. */
  async markRoomRead(chatRoomId: string, userId: string) {
    await this.requireMember(chatRoomId, userId);
    // Also clears any CHAT_MESSAGE notifications for this room — without
    // this, the sidebar's notification-driven unread badge would stay lit
    // after the room's own unread indicator was already cleared by reading it.
    await this.notifications.markChatRoomNotificationsRead(userId, chatRoomId);
    const latest = await this.prisma.client.chatMessage.findFirst({
      where: { chatRoomId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!latest) return;
    await this.prisma.client.chatMember.update({
      where: { chatRoomId_userId: { chatRoomId, userId } },
      data: { lastReadMessageId: latest.id },
    });
  }
}
