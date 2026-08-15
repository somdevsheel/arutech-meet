import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { SendChatMessageDto, CreateChatRoomDto, SendRoomChatMessageDto } from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";
import { PermissionService } from "../meetings/permission.service";
import { NotificationsService } from "../notifications/notifications.service";

const MEMBER_SELECT = {
  id: true,
  displayName: true,
  username: true,
  avatarUrl: true,
} as const;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly notifications: NotificationsService,
  ) {}

  async getMeetingChatRoom(meetingId: string) {
    const room = await this.prisma.client.chatRoom.findUnique({ where: { meetingId } });
    if (!room) throw new NotFoundException("Chat room not found for meeting");
    return room;
  }

  async history(meetingId: string, callerUserId: string, cursor?: string, take = 50) {
    await this.permissions.getParticipant(meetingId, callerUserId);
    const room = await this.getMeetingChatRoom(meetingId);

    return this.prisma.client.chatMessage.findMany({
      where: {
        chatRoomId: room.id,
        deletedAt: null,
        OR: [{ isPrivate: false }, { toUserId: callerUserId }, { senderId: callerUserId }],
      },
      include: { sender: { select: { id: true, displayName: true, avatarUrl: true } }, reactions: true },
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  /** Persists a chat message. Called from the WebSocket gateway after it has already
   * verified the sender is a connected, authorized participant for this meeting — this
   * method re-derives the capability check independently rather than trusting the caller. */
  async persistMessage(meetingId: string, senderId: string, dto: SendChatMessageDto) {
    const { role } = await this.permissions.requireCapability(meetingId, senderId, "chat.send");
    const meeting = await this.prisma.client.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: { settings: true },
    });
    if (!meeting.settings?.allowChat) {
      throw new ForbiddenException("Chat is disabled for this meeting");
    }
    void role;

    const room = await this.getMeetingChatRoom(meetingId);
    return this.prisma.client.chatMessage.create({
      data: {
        chatRoomId: room.id,
        senderId,
        body: dto.body,
        replyToId: dto.replyToId,
        isPrivate: dto.isPrivate,
        toUserId: dto.isPrivate ? dto.toUserId : null,
      },
      include: { sender: { select: { id: true, displayName: true, avatarUrl: true } } },
    });
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
        members: { create: memberIds.map((id) => ({ userId: id })) },
      },
      include: { members: { include: { user: { select: MEMBER_SELECT } } } },
    });
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
