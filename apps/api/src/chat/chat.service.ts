import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { SendChatMessageDto } from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";
import { PermissionService } from "../meetings/permission.service";

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
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
}
