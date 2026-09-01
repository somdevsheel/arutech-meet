import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ChatService } from "./chat.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { PermissionService } from "../meetings/permission.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import type { AuditLogService } from "../audit/audit-log.service";
import type { ContactsService } from "../contacts/contacts.service";
import type { StorageService } from "../storage/storage.service";
import type { OrganizationsService } from "../organizations/organizations.service";

const ROOM = { id: "room-1", meetingId: "meeting-1", type: "MEETING" };
const RAW_MESSAGE = {
  id: "msg-1",
  chatRoomId: "room-1",
  senderId: "sender-1",
  sender: { id: "sender-1", displayName: "Sender", avatarUrl: null },
  chatRoom: ROOM,
  body: "hello" as string | null,
  replyToId: null,
  isPrivate: false,
  toUserId: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  editedAt: null as Date | null,
  deletedAt: null as Date | null,
  forwardedFromSenderName: null as string | null,
  reactions: [] as { emoji: string; userId: string }[],
  attachments: [] as {
    file: { id: string; originalName: string; mimeType: string; sizeBytes: bigint };
  }[],
};

function makeDeps(overrides?: {
  message?: Partial<typeof RAW_MESSAGE> | null;
  isBlocked?: boolean;
  existingRoom?: unknown;
  groupRoom?: unknown;
  membership?: unknown;
  targetMembership?: unknown;
  adminCount?: number;
  file?: unknown;
  roomOrgSource?: {
    meeting?: { orgId: string | null };
    class?: { orgId: string | null };
    team?: { orgId: string | null };
  };
}) {
  const message = overrides?.message === null ? null : { ...RAW_MESSAGE, ...overrides?.message };
  const groupRoom =
    overrides?.groupRoom === undefined ? { id: "group-1", type: "GROUP" } : overrides.groupRoom;

  const prisma = {
    client: {
      chatRoom: {
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { id: string } }) =>
            Promise.resolve(where.id === "group-1" ? groupRoom : ROOM),
          ),
        findFirst: jest.fn().mockResolvedValue(overrides?.existingRoom ?? null),
        create: jest.fn().mockResolvedValue({ id: "room-new", type: "DIRECT" }),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: "group-1", ...data })),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue(
            overrides?.roomOrgSource ?? {
              meeting: { orgId: null },
              class: { orgId: null },
              team: { orgId: null },
            },
          ),
      },
      chatMessage: {
        findUnique: jest.fn().mockResolvedValue(message),
        findUniqueOrThrow: jest.fn().mockResolvedValue(message),
        create: jest
          .fn()
          // `attachments` is forced back to RAW_MESSAGE's `[]` after the
          // `...data` spread — `data.attachments` (when present) is the
          // create-input shape (`{ create: [...] }`), not the queried-back
          // relation shape `shapeMessage` expects, and it's `undefined`
          // entirely on a message with no attachment at all, which would
          // otherwise crash shapeMessage's `message.attachments[0]` read.
          .mockImplementation(({ data }) =>
            Promise.resolve({
              ...RAW_MESSAGE,
              id: "msg-new",
              sender: RAW_MESSAGE.sender,
              ...data,
              attachments: RAW_MESSAGE.attachments,
            }),
          ),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ ...message, ...data })),
      },
      chatReaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        delete: jest.fn(),
      },
      chatMember: {
        // First lookup in requireGroupAdmin is the CALLER's own membership;
        // a second lookup (promote/demote/addMember's duplicate check) is the
        // TARGET's — distinguish by userId since both go through the same
        // findUnique call shape.
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { chatRoomId_userId: { userId: string } } }) => {
            const targetUserId = where.chatRoomId_userId.userId;
            if (targetUserId === "caller-1") {
              return Promise.resolve(
                overrides?.membership === undefined
                  ? { id: "member-caller", isAdmin: true }
                  : overrides.membership,
              );
            }
            return Promise.resolve(
              overrides?.targetMembership === undefined
                ? { id: "member-target", isAdmin: false }
                : overrides.targetMembership,
            );
          }),
        create: jest.fn(),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: "member-target", ...data })),
        deleteMany: jest.fn(),
        count: jest.fn().mockResolvedValue(overrides?.adminCount ?? 2),
        findMany: jest.fn().mockResolvedValue([{ userId: "member-target" }]),
      },
      fileAsset: {
        findUnique: jest
          .fn()
          .mockResolvedValue(overrides?.file === undefined ? null : overrides.file),
        create: jest.fn().mockResolvedValue({ id: "file-1" }),
      },
    },
  } as unknown as PrismaService;

  const permissions = {
    // Defaults to a real (non-guest) HOST participant — the vast majority of
    // these tests are exercising an authenticated caller. Tests specifically
    // about guest behavior override this per-call via
    // `(permissions.getParticipant as jest.Mock).mockResolvedValueOnce(...)`.
    getParticipant: jest.fn().mockResolvedValue({ role: "HOST", userId: "user-1" }),
    requireCapability: jest.fn().mockResolvedValue({ role: "HOST" }),
  } as unknown as PermissionService;

  const notifications = {
    markChatRoomNotificationsRead: jest.fn(),
    create: jest.fn(),
  } as unknown as NotificationsService;
  const broadcast = {
    publish: jest.fn(),
    publishToRoom: jest.fn(),
  } as unknown as RealtimeBroadcastService;
  const auditLog = { record: jest.fn() } as unknown as AuditLogService;
  const contacts = {
    isBlocked: jest.fn().mockResolvedValue(overrides?.isBlocked ?? false),
  } as unknown as ContactsService;
  const storage = {
    getSignedUploadUrl: jest.fn().mockResolvedValue("https://upload.example"),
    getSignedDownloadUrl: jest.fn().mockResolvedValue("https://download.example"),
  } as unknown as StorageService;
  const organizations = {
    assertStorageOk: jest.fn().mockResolvedValue(undefined),
  } as unknown as OrganizationsService;

  return {
    prisma,
    permissions,
    notifications,
    broadcast,
    auditLog,
    contacts,
    storage,
    organizations,
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new ChatService(
    deps.prisma,
    deps.permissions,
    deps.notifications,
    deps.broadcast,
    deps.auditLog,
    deps.contacts,
    deps.storage,
    deps.organizations,
  );
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

describe("ChatService.createRoom — GROUP", () => {
  it("makes the creator the group's sole admin", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.createRoom("user-a", {
      type: "GROUP",
      name: "Study Buddies",
      memberUserIds: ["user-b", "user-c"],
    });

    expect(deps.prisma.client.chatRoom.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          members: {
            create: expect.arrayContaining([
              { userId: "user-a", isAdmin: true },
              { userId: "user-b", isAdmin: false },
              { userId: "user-c", isAdmin: false },
            ]),
          },
        }),
      }),
    );
  });
});

describe("ChatService group management (admin-gated)", () => {
  it("refuses a non-admin member from renaming the group", async () => {
    const deps = makeDeps({ membership: { id: "member-caller", isAdmin: false } });
    const service = makeService(deps);
    await expect(
      service.updateRoom("group-1", "caller-1", { name: "New name" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("404s managing a room that isn't actually a GROUP", async () => {
    const deps = makeDeps({ groupRoom: { id: "group-1", type: "DIRECT" } });
    const service = makeService(deps);
    await expect(service.updateRoom("group-1", "caller-1", { name: "X" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("lets an admin rename and set a photo", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    const updated = await service.updateRoom("group-1", "caller-1", {
      name: "New name",
      photoUrl: "https://x/y.png",
    });
    expect(updated).toMatchObject({ name: "New name", photoUrl: "https://x/y.png" });
  });

  // The actual bug: updateChatRoomSchema's photoUrl was `.optional()` only,
  // never `.nullable()` — there was no way for a client to ever express
  // "remove the photo" at all, since Zod would reject a literal `null` in
  // the request body before this method ever ran. Once a group's photo was
  // set, it was permanently stuck.
  it("lets an admin remove a previously-set photo by sending photoUrl: null", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    const updated = await service.updateRoom("group-1", "caller-1", { photoUrl: null });
    expect(updated).toMatchObject({ photoUrl: null });
  });

  it("leaves the photo untouched when photoUrl is omitted entirely (renaming only)", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await service.updateRoom("group-1", "caller-1", { name: "Renamed only" });
    expect(deps.prisma.client.chatRoom.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ photoUrl: undefined }) }),
    );
  });

  it("refuses adding someone who's already a member", async () => {
    const deps = makeDeps({ targetMembership: { id: "member-target", isAdmin: false } });
    const service = makeService(deps);
    await expect(service.addMember("group-1", "caller-1", "user-x")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("adds a new member as a non-admin", async () => {
    const deps = makeDeps({ targetMembership: null });
    const service = makeService(deps);
    await service.addMember("group-1", "caller-1", "user-x");
    expect(deps.prisma.client.chatMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { chatRoomId: "group-1", userId: "user-x" } }),
    );
  });

  it("refuses removing yourself via removeMember (use leave instead)", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await expect(service.removeMember("group-1", "caller-1", "caller-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("promotes a member to admin", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    const result = await service.promoteAdmin("group-1", "caller-1", "user-x");
    expect(result).toMatchObject({ isAdmin: true });
  });

  it("refuses demoting the last remaining admin", async () => {
    const deps = makeDeps({
      targetMembership: { id: "member-target", isAdmin: true },
      adminCount: 1,
    });
    const service = makeService(deps);
    await expect(service.demoteAdmin("group-1", "caller-1", "user-x")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("demotes an admin when at least one other admin remains", async () => {
    const deps = makeDeps({
      targetMembership: { id: "member-target", isAdmin: true },
      adminCount: 2,
    });
    const service = makeService(deps);
    const result = await service.demoteAdmin("group-1", "caller-1", "user-x");
    expect(result).toMatchObject({ isAdmin: false });
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
    (deps.prisma.client.chatReaction.findUnique as jest.Mock).mockResolvedValue({
      id: "reaction-1",
    });
    const service = makeService(deps);

    await service.toggleReaction("meeting-1", "user-1", "msg-1", "👍");

    expect(deps.prisma.client.chatReaction.delete).toHaveBeenCalledWith({
      where: { id: "reaction-1" },
    });
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

  // ChatReaction.userId is a required FK to User.id — a guest's identity is
  // their MeetingParticipant.id, not a User.id, so letting this through
  // would hit a DB foreign-key violation instead of a clean, expected error.
  it("rejects a guest reacting to a message — no User row to satisfy the FK", async () => {
    const deps = makeDeps();
    (deps.permissions.getParticipant as jest.Mock).mockResolvedValue({ role: "GUEST", userId: null });
    const service = makeService(deps);

    await expect(
      service.toggleReaction("meeting-1", "guest-participant-1", "msg-1", "👍"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(deps.prisma.client.chatReaction.create).not.toHaveBeenCalled();
  });

  it("404s reacting to a message from a different meeting's chat room", async () => {
    const deps = makeDeps({ message: { chatRoomId: "some-other-room" } });
    const service = makeService(deps);

    await expect(
      service.toggleReaction("meeting-1", "user-1", "msg-1", "👍"),
    ).rejects.toBeInstanceOf(NotFoundException);
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
    deps.prisma.client.meeting = {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ settings: { allowChat: true } }),
    };
    const service = makeService(deps);

    await expect(
      service.persistMessage("meeting-1", "user-1", {
        body: "hi",
        fileId: "file-1",
        isPrivate: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // A guest's `senderId` argument here is their own MeetingParticipant.id,
  // not a User.id — ChatMessage.senderId is FK'd to User, so writing it
  // straight through would violate that FK. senderGuestName is the
  // guest-safe path instead — see the schema's doc comment on that column.
  it("stores a guest sender via senderGuestName, leaving senderId null", async () => {
    const deps = makeDeps();
    (deps.permissions.getParticipant as jest.Mock).mockResolvedValue({
      role: "GUEST",
      userId: null,
      guestName: "Jamie",
    });
    // @ts-expect-error meeting lookup isn't part of PrismaService in this mock — add it
    deps.prisma.client.meeting = {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ settings: { allowChat: true } }),
    };
    const service = makeService(deps);

    await service.persistMessage("meeting-1", "guest-participant-1", { body: "hi", isPrivate: false });

    expect(deps.prisma.client.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ senderId: null, senderGuestName: "Jamie" }),
      }),
    );
  });

  it("rejects a guest trying to attach a file — FileAsset has no guest-compatible uploader", async () => {
    const deps = makeDeps();
    (deps.permissions.getParticipant as jest.Mock).mockResolvedValue({
      role: "GUEST",
      userId: null,
      guestName: "Jamie",
    });
    // @ts-expect-error meeting lookup isn't part of PrismaService in this mock — add it
    deps.prisma.client.meeting = {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ settings: { allowChat: true } }),
    };
    const service = makeService(deps);

    await expect(
      service.persistMessage("meeting-1", "guest-participant-1", {
        body: "hi",
        fileId: "file-1",
        isPrivate: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(deps.prisma.client.chatMessage.create).not.toHaveBeenCalled();
  });
});

describe("ChatService.editMessage / editRoomMessage — own-message-only", () => {
  it("refuses editing someone else's meeting-chat message", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await expect(
      service.editMessage("meeting-1", "not-the-sender", "msg-1", { body: "edited" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lets the sender edit their own meeting-chat message", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    const result = await service.editMessage("meeting-1", "sender-1", "msg-1", { body: "edited" });
    expect(result).toMatchObject({ body: "edited" });
    expect(deps.broadcast.publish).toHaveBeenCalledWith(
      "meeting-1",
      expect.stringContaining("edited"),
      expect.objectContaining({ body: "edited" }),
    );
  });

  it("refuses editing an already-deleted message", async () => {
    const deps = makeDeps({ message: { deletedAt: new Date() } });
    const service = makeService(deps);
    await expect(
      service.editMessage("meeting-1", "sender-1", "msg-1", { body: "edited" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses editing someone else's room message", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await expect(
      service.editRoomMessage("room-1", "not-the-sender", "msg-1", { body: "edited" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lets the sender edit their own room message and broadcasts to the room channel", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    const result = await service.editRoomMessage("room-1", "sender-1", "msg-1", { body: "edited" });
    expect(result).toMatchObject({ body: "edited" });
    expect(deps.broadcast.publishToRoom).toHaveBeenCalledWith(
      "chatroom:room-1",
      expect.stringContaining("edited"),
      expect.objectContaining({ body: "edited" }),
    );
  });
});

describe("ChatService.deleteRoomMessage — own-message-only", () => {
  it("refuses deleting someone else's room message (no admin/moderation override at all)", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await expect(
      service.deleteRoomMessage("room-1", "not-the-sender", "msg-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lets the sender delete their own room message", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await service.deleteRoomMessage("room-1", "sender-1", "msg-1");
    expect(deps.prisma.client.chatMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body: null, deletedAt: expect.any(Date) }),
      }),
    );
    expect(deps.broadcast.publishToRoom).toHaveBeenCalledWith(
      "chatroom:room-1",
      expect.stringContaining("deleted"),
      { messageId: "msg-1" },
    );
  });
});

describe("ChatService.forwardMessage", () => {
  it("refuses forwarding a deleted message", async () => {
    const deps = makeDeps({ message: { deletedAt: new Date() } });
    const service = makeService(deps);
    await expect(service.forwardMessage("caller-1", "target-room", "msg-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("refuses forwarding an attachment-only message (no text body)", async () => {
    const deps = makeDeps({ message: { body: null } });
    const service = makeService(deps);
    await expect(service.forwardMessage("caller-1", "target-room", "msg-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("checks meeting participancy for a MEETING-room source", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await service.forwardMessage("caller-1", "target-room", "msg-1");
    expect(deps.permissions.getParticipant).toHaveBeenCalledWith("meeting-1", "caller-1");
  });

  it("creates a new message in the target room with forwardedFromSenderName set, and notifies other target members", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    const result = await service.forwardMessage("caller-1", "target-room", "msg-1");

    expect(deps.prisma.client.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          chatRoomId: "target-room",
          senderId: "caller-1",
          body: "hello",
          forwardedFromSenderName: "Sender",
        }),
      }),
    );
    expect(result).toMatchObject({ forwardedFromSenderName: "Sender" });
    expect(deps.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "member-target", type: "CHAT_MESSAGE" }),
    );
  });
});

describe("ChatService.presignRoomAttachment", () => {
  it("refuses a disallowed MIME type", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await expect(
      service.presignRoomAttachment("room-1", "caller-1", {
        fileName: "virus.exe",
        mimeType: "application/x-msdownload",
        sizeBytes: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("presigns a voice message upload (audio/webm) with scope CHAT", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    const result = await service.presignRoomAttachment("room-1", "caller-1", {
      fileName: "voice.webm",
      mimeType: "audio/webm",
      sizeBytes: 5000,
    });
    expect(deps.prisma.client.fileAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scope: "CHAT", chatRoomId: "room-1" }),
      }),
    );
    expect(result).toMatchObject({ fileId: "file-1" });
  });

  // Regression coverage: this path created FileAsset rows with no orgId and
  // never checked any org's storage limit — a room's org (via its linked
  // meeting/class/team) was silently never attributed or enforced no matter
  // how much was uploaded through Team Chat — see git history.
  it("checks the org's storage limit for a room linked to an org meeting", async () => {
    const deps = makeDeps({ roomOrgSource: { meeting: { orgId: "org-1" } } });
    const service = makeService(deps);

    await service.presignRoomAttachment("room-1", "caller-1", {
      fileName: "voice.webm",
      mimeType: "audio/webm",
      sizeBytes: 5000,
    });

    expect(deps.organizations.assertStorageOk).toHaveBeenCalledWith("org-1", 5000);
    expect(deps.prisma.client.fileAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: "org-1" }) }),
    );
  });

  it("never checks the limit for a DIRECT/GROUP room with no org behind it", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.presignRoomAttachment("room-1", "caller-1", {
      fileName: "voice.webm",
      mimeType: "audio/webm",
      sizeBytes: 5000,
    });

    expect(deps.organizations.assertStorageOk).not.toHaveBeenCalled();
  });

  it("propagates a storage-limit rejection instead of creating the file", async () => {
    const deps = makeDeps({ roomOrgSource: { meeting: { orgId: "org-1" } } });
    (deps.organizations.assertStorageOk as jest.Mock).mockRejectedValue(
      new ForbiddenException("limit reached"),
    );
    const service = makeService(deps);

    await expect(
      service.presignRoomAttachment("room-1", "caller-1", {
        fileName: "voice.webm",
        mimeType: "audio/webm",
        sizeBytes: 5000,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(deps.prisma.client.fileAsset.create).not.toHaveBeenCalled();
  });
});

describe("ChatService.persistRoomMessage — attachments", () => {
  it("rejects attaching a file uploaded by someone else, or to a different room", async () => {
    const deps = makeDeps({
      file: { id: "file-1", chatRoomId: "room-1", uploaderUserId: "someone-else" },
    });
    const service = makeService(deps);
    await expect(
      service.persistRoomMessage("room-1", "sender-1", { fileId: "file-1" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts a file uploaded by the sender to this same room", async () => {
    const deps = makeDeps({
      file: { id: "file-1", chatRoomId: "room-1", uploaderUserId: "sender-1" },
    });
    const service = makeService(deps);
    const result = await service.persistRoomMessage("room-1", "sender-1", { fileId: "file-1" });
    expect(deps.prisma.client.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attachments: { create: [{ fileId: "file-1" }] } }),
      }),
    );
    expect(result.senderId).toBe("sender-1");
  });
});
