import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import type {
  SendChatMessageDto,
  CreateChatRoomDto,
  SendRoomChatMessageDto,
  UpdateChatRoomDto,
  EditMessageDto,
  PresignUploadDto,
} from "@arutech/validation";
import { WS_EVENTS, can, type ChatMessagePayload, type ChatMessageReactionGroup, type ParticipantRole } from "@arutech/types";
import { PrismaService } from "../prisma/prisma.service";
import { PermissionService } from "../meetings/permission.service";
import { NotificationsService } from "../notifications/notifications.service";
import { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import { AuditLogService } from "../audit/audit-log.service";
import { ContactsService } from "../contacts/contacts.service";
import { StorageService } from "../storage/storage.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { isAllowedMimeType, sanitizeFileName } from "../files/file-upload.util";

const MEMBER_SELECT = {
  id: true,
  displayName: true,
  username: true,
  avatarUrl: true,
  lastSeenAt: true,
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
  editedAt: Date | null;
  deletedAt: Date | null;
  forwardedFromSenderName: string | null;
  senderGuestName: string | null;
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
    private readonly storage: StorageService,
    private readonly organizations: OrganizationsService,
  ) {}

  /** Shapes a raw Prisma row (with MESSAGE_INCLUDE) into the wire format both
   * REST history and every WS broadcast use — keeping these consistent is
   * what lets the client treat a message loaded via `GET .../messages` and
   * one that arrived live over the socket identically. Shared by meeting chat
   * AND Team Chat room messages (same `ChatMessage` table underneath, no
   * per-room-type branching needed here). */
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
      senderName: message.sender?.displayName ?? message.senderGuestName ?? "Unknown",
      body: message.body,
      replyToId: message.replyToId,
      isPrivate: message.isPrivate,
      toUserId: message.toUserId,
      createdAt: message.createdAt.toISOString(),
      editedAt: message.editedAt?.toISOString() ?? null,
      deletedAt: message.deletedAt?.toISOString() ?? null,
      forwardedFromSenderName: message.forwardedFromSenderName,
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
   * method re-derives the capability check independently rather than trusting the caller.
   *
   * `senderId` is whatever PermissionService.getParticipant accepts for either kind of
   * caller: a real User.id, or — for a guest — their own MeetingParticipant.id. Resolving
   * the full participant row here (rather than the narrower requireCapability) is what lets
   * this tell the two apart, since a guest's row has `userId: null` and `guestName` set.
   */
  async persistMessage(meetingId: string, senderId: string, dto: SendChatMessageDto): Promise<ChatMessagePayload> {
    const participant = await this.permissions.getParticipant(meetingId, senderId);
    if (!can(participant.role as ParticipantRole, "chat.send")) {
      throw new ForbiddenException(`Role ${participant.role} does not have permission: chat.send`);
    }
    const meeting = await this.prisma.client.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: { settings: true },
    });
    if (!meeting.settings?.allowChat) {
      throw new ForbiddenException("Chat is disabled for this meeting");
    }

    const isGuest = !participant.userId;
    // FileAsset.uploaderUserId is a required FK to User — a guest has no such
    // row to have uploaded one under, so there's nothing valid to attach.
    // (Guest file/voice-message attachments are a real but separate feature;
    // this only guards against the FK violation a guest fileId would hit.)
    if (dto.fileId && isGuest) {
      throw new BadRequestException("Guests can't send file attachments");
    }
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
        // ChatMessage.senderId is FK'd to User.id — a guest's `senderId`
        // above is their MeetingParticipant.id, not a User.id, so it must
        // never be written there (would fail the FK, or worse, someday
        // collide with an unrelated real user's id). senderGuestName is the
        // guest-safe equivalent; see its schema doc comment.
        senderId: isGuest ? null : senderId,
        senderGuestName: isGuest ? (participant.guestName ?? "Guest") : null,
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
    const participant = await this.permissions.getParticipant(meetingId, callerUserId);
    // ChatReaction.userId is a required FK to User.id — a guest's identity
    // here is their MeetingParticipant.id, which isn't one. Reacting to chat
    // messages as a guest is a real feature gap, not something to silently
    // corrupt or crash on; reject it clearly instead until it's built.
    if (!participant.userId) {
      throw new ForbiddenException("Guests can't react to chat messages yet");
    }
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

  /** Own-message-only — unlike delete, there's no "edit any message"
   * capability for a host to reach for; editing someone else's words (even as
   * a moderation action) is a different, more editorial kind of power than
   * removing them, and isn't something this app grants anyone. */
  async editMessage(meetingId: string, callerUserId: string, messageId: string, dto: EditMessageDto) {
    const message = await this.getMeetingScopedMessage(meetingId, messageId);
    if (message.senderId !== callerUserId) {
      throw new ForbiddenException("You can only edit your own messages");
    }
    if (message.deletedAt) {
      throw new BadRequestException("Can't edit a deleted message");
    }

    const updated = await this.prisma.client.chatMessage.update({
      where: { id: messageId },
      data: { body: dto.body, editedAt: new Date() },
      include: MESSAGE_INCLUDE,
    });
    const payload = this.shapeMessage(updated);
    await this.broadcast.publish(meetingId, WS_EVENTS.CHAT_MESSAGE_EDITED, payload);
    return payload;
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
    const updated = await this.prisma.client.chatRoom.update({
      where: { id: room.id },
      data: { name: dto.name, photoUrl: dto.photoUrl },
    });
    await this.broadcastRoomUpdated(room.id);
    return updated;
  }

  async addMember(chatRoomId: string, userId: string, targetUserId: string) {
    const room = await this.requireGroupAdmin(chatRoomId, userId);
    const existing = await this.prisma.client.chatMember.findUnique({
      where: { chatRoomId_userId: { chatRoomId: room.id, userId: targetUserId } },
    });
    if (existing) throw new ConflictException("Already a member of this group");
    const member = await this.prisma.client.chatMember.create({ data: { chatRoomId: room.id, userId: targetUserId } });
    await this.broadcastRoomUpdated(room.id);
    return member;
  }

  /** Removing yourself is `POST /chat-rooms/:id/leave` (self-service, no
   * admin needed) — this is specifically an admin removing someone else. */
  async removeMember(chatRoomId: string, userId: string, targetUserId: string): Promise<void> {
    const room = await this.requireGroupAdmin(chatRoomId, userId);
    if (targetUserId === userId) {
      throw new BadRequestException("Use leave to remove yourself");
    }
    await this.prisma.client.chatMember.deleteMany({ where: { chatRoomId: room.id, userId: targetUserId } });
    await this.broadcastRoomUpdated(room.id);
  }

  async promoteAdmin(chatRoomId: string, userId: string, targetUserId: string) {
    const room = await this.requireGroupAdmin(chatRoomId, userId);
    const target = await this.prisma.client.chatMember.findUnique({
      where: { chatRoomId_userId: { chatRoomId: room.id, userId: targetUserId } },
    });
    if (!target) throw new NotFoundException("Not a member of this group");
    const promoted = await this.prisma.client.chatMember.update({ where: { id: target.id }, data: { isAdmin: true } });
    await this.broadcastRoomUpdated(room.id);
    return promoted;
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

    const demoted = await this.prisma.client.chatMember.update({ where: { id: target.id }, data: { isAdmin: false } });
    await this.broadcastRoomUpdated(room.id);
    return demoted;
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

  /** Signals every open panel on this room to refetch — group details,
   * membership, and admin status all change infrequently enough that pushing
   * the full new state isn't worth a second payload shape; the client already
   * has the GET to call (see WS_EVENTS.ROOM_UPDATED's own doc comment). */
  private async broadcastRoomUpdated(chatRoomId: string): Promise<void> {
    await this.broadcast.publishToRoom(`chatroom:${chatRoomId}`, WS_EVENTS.ROOM_UPDATED, { chatRoomId });
  }

  // Not filtered to deletedAt: null — same as meeting chat's history(), a
  // deleted room message still returns as a row with body: null so the
  // client can render "Message deleted" in place rather than the message
  // just silently vanishing from history with no explanation.
  async roomHistory(chatRoomId: string, userId: string, cursor?: string, take = 50) {
    await this.requireMember(chatRoomId, userId);
    const messages = await this.prisma.client.chatMessage.findMany({
      where: { chatRoomId },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: "desc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return messages.map((m) => this.shapeMessage(m));
  }

  async getRoomMemberIds(chatRoomId: string): Promise<string[]> {
    const members = await this.prisma.client.chatMember.findMany({
      where: { chatRoomId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  /** The reverse of the above — every room this user belongs to (any type:
   * MEETING/CLASS/TEAM/GROUP/DIRECT). Used by RealtimeGateway to fan a
   * presence-status change out to `chatroom:{id}` for each one, the same
   * reach limitation ROOM_UPDATED already has (only reaches clients that
   * currently have that room open). */
  async getRoomIdsForUser(userId: string): Promise<string[]> {
    const memberships = await this.prisma.client.chatMember.findMany({
      where: { userId },
      select: { chatRoomId: true },
    });
    return memberships.map((m) => m.chatRoomId);
  }

  async persistRoomMessage(chatRoomId: string, senderId: string, dto: SendRoomChatMessageDto): Promise<ChatMessagePayload> {
    await this.requireMember(chatRoomId, senderId);

    if (dto.fileId) await this.assertRoomFile(chatRoomId, senderId, dto.fileId);

    const message = await this.prisma.client.chatMessage.create({
      data: {
        chatRoomId,
        senderId,
        body: dto.body,
        replyToId: dto.replyToId,
        attachments: dto.fileId ? { create: [{ fileId: dto.fileId }] } : undefined,
      },
      include: MESSAGE_INCLUDE,
    });
    // The sender has, by definition, read their own message — keeps their own
    // unread badge from lighting up on a room they just posted in.
    await this.prisma.client.chatMember.update({
      where: { chatRoomId_userId: { chatRoomId, userId: senderId } },
      data: { lastReadMessageId: message.id },
    });
    return this.shapeMessage(message);
  }

  /** Own-message-only, same reasoning as editMessage above. */
  async editRoomMessage(chatRoomId: string, callerUserId: string, messageId: string, dto: EditMessageDto) {
    const message = await this.getRoomScopedMessage(chatRoomId, messageId);
    if (message.senderId !== callerUserId) {
      throw new ForbiddenException("You can only edit your own messages");
    }
    if (message.deletedAt) {
      throw new BadRequestException("Can't edit a deleted message");
    }

    const updated = await this.prisma.client.chatMessage.update({
      where: { id: messageId },
      data: { body: dto.body, editedAt: new Date() },
      include: MESSAGE_INCLUDE,
    });
    const payload = this.shapeMessage(updated);
    await this.broadcast.publishToRoom(`chatroom:${chatRoomId}`, WS_EVENTS.ROOM_MESSAGE_EDITED, payload);
    return payload;
  }

  /** Own-message-only — Team Chat has no hosts/moderators the way a meeting
   * does, and group admin (Stage 23) manages membership, not message content,
   * so there's no "delete any message" capability here at all, not even for
   * a group admin. */
  async deleteRoomMessage(chatRoomId: string, callerUserId: string, messageId: string): Promise<void> {
    const message = await this.getRoomScopedMessage(chatRoomId, messageId);
    if (message.senderId !== callerUserId) {
      throw new ForbiddenException("You can only delete your own messages");
    }

    await this.prisma.client.chatMessage.update({
      where: { id: messageId },
      data: { body: null, deletedAt: new Date() },
    });
    await this.broadcast.publishToRoom(`chatroom:${chatRoomId}`, WS_EVENTS.ROOM_MESSAGE_DELETED, { messageId });
  }

  /** Forwards a message's TEXT to another room the caller is a member of.
   * Deliberately text-only in this v1 — an attachment/voice message can't be
   * forwarded (refused outright below) rather than silently forwarding an
   * empty body: the attachment's download permission is scoped to its
   * original meeting/class/room, and re-pointing a `ChatAttachment` at a
   * brand-new room without re-checking that would either break the download
   * for the new room's members or, worse, accidentally grant them access to
   * a file from a context they were never part of. The source can be EITHER
   * a meeting-chat message or another Team Chat room's message — both live in
   * the same `ChatMessage` table, the only difference is which permission
   * check applies to reading the source (meeting participancy vs. room
   * membership), resolved here from the source's own `ChatRoom.type` rather
   * than requiring the caller to say which kind it is. */
  async forwardMessage(callerUserId: string, targetChatRoomId: string, sourceMessageId: string) {
    const source = await this.prisma.client.chatMessage.findUnique({
      where: { id: sourceMessageId },
      include: { chatRoom: true, sender: { select: { displayName: true } } },
    });
    if (!source) throw new NotFoundException("Message not found");
    if (source.deletedAt || !source.body) {
      throw new BadRequestException("Nothing to forward — this message has no text (or was deleted)");
    }

    if (source.chatRoom.type === "MEETING" || source.chatRoom.type === "CLASS") {
      if (!source.chatRoom.meetingId) throw new NotFoundException("Message not found");
      await this.permissions.getParticipant(source.chatRoom.meetingId, callerUserId);
    } else {
      await this.requireMember(source.chatRoomId, callerUserId);
    }
    await this.requireMember(targetChatRoomId, callerUserId);

    const message = await this.prisma.client.chatMessage.create({
      data: {
        chatRoomId: targetChatRoomId,
        senderId: callerUserId,
        body: source.body,
        forwardedFromSenderName: source.sender?.displayName ?? "Unknown",
      },
      include: MESSAGE_INCLUDE,
    });
    const payload = this.shapeMessage(message);
    await this.broadcast.publishToRoom(`chatroom:${targetChatRoomId}`, WS_EVENTS.ROOM_MESSAGE, payload);

    // No cheap way to tell who's actively viewing from a REST handler (that
    // distinction is only available inside the gateway, which owns the live
    // socket set) — forwarding is low-frequency enough that notifying every
    // other member unconditionally, rather than only the ones not currently
    // looking at it, is an acceptable simplification over ROOM_MESSAGE's own
    // socket-aware path in RealtimeGateway.onRoomMessage.
    const memberIds = await this.getRoomMemberIds(targetChatRoomId);
    for (const memberId of memberIds) {
      if (memberId === callerUserId) continue;
      await this.notifications.create({
        userId: memberId,
        type: "CHAT_MESSAGE",
        title: payload.senderName,
        body: payload.body?.slice(0, 140) ?? "",
        data: { chatRoomId: targetChatRoomId },
      });
    }

    return payload;
  }

  /** Presigned upload for a Team Chat room attachment (file or voice
   * message) — the `CHAT` FileScope value existed unused before this stage;
   * mirrors FilesService.presignMeetingUpload, scoped to a `chatRoomId`
   * instead of a `meetingId`, including the same org-storage-limit
   * enforcement (this path didn't actually have that half of the mirror
   * until now — see the orgId resolution below). */
  async presignRoomAttachment(chatRoomId: string, callerUserId: string, dto: PresignUploadDto) {
    await this.requireMember(chatRoomId, callerUserId);

    if (!isAllowedMimeType(dto.mimeType)) {
      throw new BadRequestException(`File type ${dto.mimeType} is not allowed`);
    }

    // A room's org (if any) comes from whichever of meeting/class/team it's
    // linked to — DIRECT and GROUP rooms have none of the three, so orgId
    // stays null and no limit applies, same as a personal (non-org) meeting
    // or class today.
    const room = await this.prisma.client.chatRoom.findUniqueOrThrow({
      where: { id: chatRoomId },
      select: {
        meeting: { select: { orgId: true } },
        class: { select: { orgId: true } },
        team: { select: { orgId: true } },
      },
    });
    const orgId = room.meeting?.orgId ?? room.class?.orgId ?? room.team?.orgId ?? null;
    if (orgId) {
      await this.organizations.assertStorageOk(orgId, dto.sizeBytes);
    }

    const safeName = sanitizeFileName(dto.fileName);
    const storageKey = `chat-uploads/room/${chatRoomId}/${Date.now()}-${randomUUID()}-${safeName}`;

    const file = await this.prisma.client.fileAsset.create({
      data: {
        uploaderUserId: callerUserId,
        scope: "CHAT",
        chatRoomId,
        orgId,
        storageKey,
        originalName: safeName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        virusScanStatus: "PENDING",
      },
    });

    const uploadUrl = await this.storage.getSignedUploadUrl(storageKey, dto.mimeType);
    return { fileId: file.id, uploadUrl };
  }

  /** Permission-checked download for a room attachment — the caller must be
   * a member of the room the file was actually uploaded to, mirroring
   * FilesService.getDownloadUrl's meeting-scoped equivalent. */
  async getRoomAttachmentDownloadUrl(chatRoomId: string, callerUserId: string, fileId: string) {
    await this.requireMember(chatRoomId, callerUserId);

    const file = await this.prisma.client.fileAsset.findUnique({ where: { id: fileId } });
    if (!file || file.chatRoomId !== chatRoomId || file.deletedAt) {
      throw new NotFoundException("File not found");
    }
    if (file.virusScanStatus === "INFECTED") {
      throw new ForbiddenException("This file failed a virus scan and cannot be downloaded");
    }

    const url = await this.storage.getSignedDownloadUrl(file.storageKey);
    return { url, fileName: file.originalName, mimeType: file.mimeType, expiresInSeconds: 600 };
  }

  /** A fileId supplied on a room message must actually be a `CHAT`-scoped
   * file belonging to THIS room, uploaded by the caller — prevents attaching
   * someone else's file, or a file uploaded to a different room/meeting
   * entirely, by guessing/reusing an id (same pattern
   * AssignmentsService.assertClassFile already established). */
  private async assertRoomFile(chatRoomId: string, uploaderUserId: string, fileId: string): Promise<void> {
    const file = await this.prisma.client.fileAsset.findUnique({ where: { id: fileId } });
    if (!file || file.chatRoomId !== chatRoomId || file.uploaderUserId !== uploaderUserId) {
      throw new BadRequestException("Invalid attachment");
    }
  }

  /** Loads a message and confirms it actually belongs to this ChatRoom —
   * same reasoning as getMeetingScopedMessage above. */
  private async getRoomScopedMessage(chatRoomId: string, messageId: string) {
    const message = await this.prisma.client.chatMessage.findUnique({ where: { id: messageId } });
    if (!message || message.chatRoomId !== chatRoomId) {
      throw new NotFoundException("Message not found");
    }
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
    const membership = await this.requireMember(chatRoomId, userId);
    // H-6: the sole admin leaving used to permanently orphan the group — no
    // one left could ever manage it again (promoteAdmin/demoteAdmin/remove
    // are all admin-gated, and there'd be nobody left to grant that back).
    // demoteAdmin already refuses to demote a group's last admin for this
    // exact reason; leaving is just another way to lose that same admin, so
    // it needs the identical guard.
    if (membership.isAdmin) {
      const adminCount = await this.prisma.client.chatMember.count({ where: { chatRoomId, isAdmin: true } });
      if (adminCount <= 1) {
        throw new BadRequestException(
          "You're the only admin — promote another member to admin before leaving",
        );
      }
    }
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
