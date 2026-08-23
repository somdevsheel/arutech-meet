import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ChatService } from "./chat.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { PermissionService } from "../meetings/permission.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import type { AuditLogService } from "../audit/audit-log.service";
import type { ContactsService } from "../contacts/contacts.service";

const ROOM = { id: "room-1", meetingId: "meeting-1" };
const RAW_MESSAGE = {
  id: "msg-1",
  chatRoomId: "room-1",
  senderId: "sender-1",
  sender: { id: "sender-1", displayName: "Sender", avatarUrl: null },
  body: "hello",
  replyToId: null,
  isPrivate: false,
  toUserId: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
  reactions: [] as { emoji: string; userId: string }[],
  attachments: [] as { file: { id: string; originalName: string; mimeType: string; sizeBytes: bigint } }[],
};

function makeDeps(overrides?: { message?: Partial<typeof RAW_MESSAGE> | null; isBlocked?: boolean; existingRoom?: unknown }) {
  const message = overrides?.message === null ? null : { ...RAW_MESSAGE, ...overrides?.message };

  const prisma = {
    client: {
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue(ROOM),
        findFirst: jest.fn().mockResolvedValue(overrides?.existingRoom ?? null),
        create: jest.fn().mockResolvedValue({ id: "room-new", type: "DIRECT" }),
      },
      chatMessage: {
        findUnique: jest.fn().mockResolvedValue(message),
        findUniqueOrThrow: jest.fn().mockResolvedValue(message),
        update: jest.fn(),
      },
      chatReaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        delete: jest.fn(),
      },
      fileAsset: { findUnique: jest.fn() },
    },
  } as unknown as PrismaService;

  const permissions = {
    getParticipant: jest.fn().mockResolvedValue({}),
    requireCapability: jest.fn().mockResolvedValue({ role: "HOST" }),
  } as unknown as PermissionService;

  const notifications = { markChatRoomNotificationsRead: jest.fn() } as unknown as NotificationsService;
  const broadcast = { publish: jest.fn() } as unknown as RealtimeBroadcastService;
  const auditLog = { record: jest.fn() } as unknown as AuditLogService;
  const contacts = { isBlocked: jest.fn().mockResolvedValue(overrides?.isBlocked ?? false) } as unknown as ContactsService;

  return { prisma, permissions, notifications, broadcast, auditLog, contacts };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new ChatService(deps.prisma, deps.permissions, deps.notifications, deps.broadcast, deps.auditLog, deps.contacts);
}

describe("ChatService.createRoom — DIRECT", () => {
  it("refuses to create a DM between two people with a block relationship", async () => {
    const deps = makeDeps({ isBlocked: true });
    const service = makeService(deps);
    await expect(
      service.createRoom("user-a", { type: "DIRECT", memberUserIds: ["user-b"] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(deps.prisma.client.chatRoom.create).not.toHaveBeenCalled();
  });

  it("creates the DM when there's no block relationship", async () => {
    const deps = makeDeps({ isBlocked: false });
    const service = makeService(deps);
    const room = await service.createRoom("user-a", { type: "DIRECT", memberUserIds: ["user-b"] });
    expect(room).toMatchObject({ id: "room-new" });
  });
});

describe("ChatService.toggleReaction", () => {
  it("adds a reaction when none exists yet", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.toggleReaction("meeting-1", "user-1", "msg-1", "👍");

    expect(deps.prisma.client.chatReaction.create).toHaveBeenCalledWith({
      data: { messageId: "msg-1", userId: "user-1", emoji: "👍" },
    });
    expect(deps.prisma.client.chatReaction.delete).not.toHaveBeenCalled();
  });

  it("removes the reaction on a second toggle", async () => {
    const deps = makeDeps();
    (deps.prisma.client.chatReaction.findUnique as jest.Mock).mockResolvedValue({ id: "reaction-1" });
    const service = makeService(deps);

    await service.toggleReaction("meeting-1", "user-1", "msg-1", "👍");

    expect(deps.prisma.client.chatReaction.delete).toHaveBeenCalledWith({ where: { id: "reaction-1" } });
    expect(deps.prisma.client.chatReaction.create).not.toHaveBeenCalled();
  });

  it("groups reactions by emoji in the returned payload", async () => {
    const deps = makeDeps({
      message: {
        reactions: [
          { emoji: "👍", userId: "user-1" },
          { emoji: "👍", userId: "user-2" },
          { emoji: "❤️", userId: "user-1" },
        ],
      },
    });
    const service = makeService(deps);

    const result = await service.toggleReaction("meeting-1", "user-1", "msg-1", "👍");

    expect(result.reactions).toEqual(
      expect.arrayContaining([
        { emoji: "👍", userIds: expect.arrayContaining(["user-1", "user-2"]) },
        { emoji: "❤️", userIds: ["user-1"] },
      ]),
    );
  });

  it("404s reacting to a message from a different meeting's chat room", async () => {
    const deps = makeDeps({ message: { chatRoomId: "some-other-room" } });
    const service = makeService(deps);

    await expect(service.toggleReaction("meeting-1", "user-1", "msg-1", "👍")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("ChatService.deleteMessage", () => {
  it("lets the sender delete their own message without a capability check", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.deleteMessage("meeting-1", "sender-1", "msg-1");

    expect(deps.permissions.requireCapability).not.toHaveBeenCalled();
    expect(deps.prisma.client.chatMessage.update).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { body: null, deletedAt: expect.any(Date) },
    });
    expect(deps.broadcast.publish).toHaveBeenCalledWith(
      "meeting-1",
      expect.stringContaining("chat"),
      { messageId: "msg-1" },
    );
  });

  it("requires chat.delete_any_message and audit-logs deleting someone else's message", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.deleteMessage("meeting-1", "host-1", "msg-1");

    expect(deps.permissions.requireCapability).toHaveBeenCalledWith(
      "meeting-1",
      "host-1",
      "chat.delete_any_message",
    );
    expect(deps.auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "chat.delete_message", targetId: "msg-1" }),
    );
  });

  it("refuses without the capability", async () => {
    const deps = makeDeps();
    (deps.permissions.requireCapability as jest.Mock).mockRejectedValue(new ForbiddenException());
    const service = makeService(deps);

    await expect(service.deleteMessage("meeting-1", "random-user", "msg-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(deps.prisma.client.chatMessage.update).not.toHaveBeenCalled();
  });
});

describe("ChatService.persistMessage", () => {
  it("rejects attaching a file uploaded by someone else", async () => {
    const deps = makeDeps();
    (deps.prisma.client.fileAsset.findUnique as jest.Mock).mockResolvedValue({
      id: "file-1",
      meetingId: "meeting-1",
      uploaderUserId: "someone-else",
    });
    (deps.permissions.requireCapability as jest.Mock).mockResolvedValue({ role: "PARTICIPANT" });
    // @ts-expect-error meeting lookup isn't part of PrismaService in this mock — add it
    deps.prisma.client.meeting = { findUniqueOrThrow: jest.fn().mockResolvedValue({ settings: { allowChat: true } }) };
    const service = makeService(deps);

    await expect(
      service.persistMessage("meeting-1", "user-1", { body: "hi", fileId: "file-1", isPrivate: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
