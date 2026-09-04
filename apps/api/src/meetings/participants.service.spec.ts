import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ParticipantsService } from "./participants.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { LiveKitService } from "../livekit/livekit.service";
import type { PermissionService } from "./permission.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import type { AuditLogService } from "../audit/audit-log.service";
import type { ContactsService } from "../contacts/contacts.service";

const MEETING = { id: "meeting-1", livekitRoomName: "room-1" };
const PARTICIPANT = { id: "participant-1", meetingId: "meeting-1", userId: "target-1", livekitIdentity: "target-1-abc" };
const GUEST_PARTICIPANT = { id: "participant-2", meetingId: "meeting-1", userId: null, livekitIdentity: "guest-xyz" };
const WAITING_PARTICIPANT = { ...PARTICIPANT, status: "WAITING" };
const WAITING_GUEST_PARTICIPANT = { ...GUEST_PARTICIPANT, status: "WAITING" };

function makeService(overrides?: {
  participant?: typeof PARTICIPANT | typeof GUEST_PARTICIPANT | typeof WAITING_PARTICIPANT;
}) {
  const participant = overrides?.participant ?? PARTICIPANT;
  const prisma = {
    client: {
      meetingParticipant: {
        findUnique: jest.fn().mockResolvedValue(participant),
        update: jest.fn().mockResolvedValue({ ...participant, status: "REMOVED" }),
      },
      meeting: { findUniqueOrThrow: jest.fn().mockResolvedValue(MEETING) },
      meetingEvent: { create: jest.fn().mockResolvedValue(undefined) },
      user: { findUnique: jest.fn().mockResolvedValue({ displayName: "Real Display Name" }) },
    },
  } as unknown as PrismaService;
  const liveKit = {
    removeParticipant: jest.fn().mockResolvedValue(undefined),
    updateParticipantPermissions: jest.fn().mockResolvedValue(undefined),
  } as unknown as LiveKitService;
  const permissions = { requireOwnerOrCapability: jest.fn().mockResolvedValue(undefined) } as unknown as PermissionService;
  const broadcast = {
    publish: jest.fn().mockResolvedValue(undefined),
    publishToRoom: jest.fn().mockResolvedValue(undefined),
  } as unknown as RealtimeBroadcastService;
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService;
  const contacts = { block: jest.fn().mockResolvedValue(undefined) } as unknown as ContactsService;

  const service = new ParticipantsService(prisma, liveKit, permissions, broadcast, auditLog, contacts);
  return { service, prisma, liveKit, permissions, broadcast, auditLog, contacts };
}

describe("ParticipantsService.block", () => {
  it("requires the same participant.remove capability Remove already requires", async () => {
    const { service, permissions } = makeService();
    await service.block(MEETING.id, "caller-1", PARTICIPANT.id);
    expect(permissions.requireOwnerOrCapability).toHaveBeenCalledWith(MEETING.id, "caller-1", "participant.remove");
  });

  it("removes the participant from LiveKit and marks them REMOVED, same as a plain Remove", async () => {
    const { service, liveKit, prisma } = makeService();
    await service.block(MEETING.id, "caller-1", PARTICIPANT.id);
    expect(liveKit.removeParticipant).toHaveBeenCalledWith(MEETING.livekitRoomName, PARTICIPANT.livekitIdentity);
    expect(prisma.client.meetingParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PARTICIPANT.id }, data: expect.objectContaining({ status: "REMOVED" }) }),
    );
  });

  it("creates a real BlockedUser row via ContactsService.block, from the caller to the target", async () => {
    const { service, contacts } = makeService();
    await service.block(MEETING.id, "caller-1", PARTICIPANT.id);
    expect(contacts.block).toHaveBeenCalledWith("caller-1", PARTICIPANT.userId);
  });

  it("audit-logs the block as its own distinct action", async () => {
    const { service, auditLog } = makeService();
    await service.block(MEETING.id, "caller-1", PARTICIPANT.id);
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: "caller-1", action: "participant.block", targetId: PARTICIPANT.id }),
    );
  });

  it("refuses to block a guest — nothing to attach a BlockedUser row to", async () => {
    const { service, liveKit, contacts } = makeService({ participant: GUEST_PARTICIPANT });
    await expect(service.block(MEETING.id, "caller-1", GUEST_PARTICIPANT.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(liveKit.removeParticipant).not.toHaveBeenCalled();
    expect(contacts.block).not.toHaveBeenCalled();
  });
});

describe("ParticipantsService.admit", () => {
  it("marks the participant ADMITTED", async () => {
    const { service, prisma } = makeService({ participant: WAITING_PARTICIPANT });
    await service.admit(MEETING.id, "caller-1", WAITING_PARTICIPANT.id);
    expect(prisma.client.meetingParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: WAITING_PARTICIPANT.id }, data: { status: "ADMITTED" } }),
    );
  });

  it("publishes to the admitted user's own personal room, not just the meeting room", async () => {
    const { service, broadcast } = makeService({ participant: WAITING_PARTICIPANT });
    await service.admit(MEETING.id, "caller-1", WAITING_PARTICIPANT.id);
    expect(broadcast.publishToRoom).toHaveBeenCalledWith(
      `user:${WAITING_PARTICIPANT.userId}`,
      expect.stringContaining("admit"),
      expect.objectContaining({ participantId: WAITING_PARTICIPANT.id }),
    );
  });

  // Same guest-reachability fix as deny() below — a WAITING guest's socket
  // is in its own personal room (keyed on their MeetingParticipant.id, not a
  // User.id they don't have), and that's the only way they ever learn
  // they've been let in.
  it("publishes to a guest's own personal room too, keyed on their participant id", async () => {
    const { service, broadcast } = makeService({ participant: WAITING_GUEST_PARTICIPANT });
    await service.admit(MEETING.id, "caller-1", WAITING_GUEST_PARTICIPANT.id);
    expect(broadcast.publishToRoom).toHaveBeenCalledWith(
      `user:${WAITING_GUEST_PARTICIPANT.id}`,
      expect.stringContaining("admit"),
      expect.objectContaining({ participantId: WAITING_GUEST_PARTICIPANT.id }),
    );
  });
});

// Regression coverage: deny() used to publish only to the meeting room,
// which a still-WAITING participant's socket was never actually a member of
// (see admit()'s own comment on the exact same limitation, which admit()
// itself was already fixed for) — the denied person never received any
// signal at all and their screen just spun on "Waiting for the host..."
// forever. See git history for the finding.
describe("ParticipantsService.deny", () => {
  it("marks the participant DENIED", async () => {
    const { service, prisma } = makeService({ participant: WAITING_PARTICIPANT });
    await service.deny(MEETING.id, "caller-1", WAITING_PARTICIPANT.id);
    expect(prisma.client.meetingParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: WAITING_PARTICIPANT.id }, data: { status: "DENIED" } }),
    );
  });

  it("publishes to the denied user's own personal room, not just the meeting room", async () => {
    const { service, broadcast } = makeService({ participant: WAITING_PARTICIPANT });
    await service.deny(MEETING.id, "caller-1", WAITING_PARTICIPANT.id);
    expect(broadcast.publishToRoom).toHaveBeenCalledWith(
      `user:${WAITING_PARTICIPANT.userId}`,
      expect.stringContaining("deny"),
      expect.objectContaining({ participantId: WAITING_PARTICIPANT.id }),
    );
    expect(broadcast.publish).toHaveBeenCalledWith(
      MEETING.id,
      expect.stringContaining("deny"),
      expect.objectContaining({ participantId: WAITING_PARTICIPANT.id }),
    );
  });

  // A guest's socket joins its personal room keyed on their own
  // MeetingParticipant.id instead of a User.id (see RealtimeGateway.
  // handleConnection / TokenService.GuestTokenPayload) — that's the ONLY
  // channel a still-WAITING guest has to ever learn they were denied at
  // all, so this must reach them the exact same way an authenticated
  // user's deny does, just keyed on `participant.id` instead of
  // `participant.userId`.
  it("publishes to a guest's own personal room too, keyed on their participant id", async () => {
    const { service, broadcast } = makeService({ participant: WAITING_GUEST_PARTICIPANT });
    await service.deny(MEETING.id, "caller-1", WAITING_GUEST_PARTICIPANT.id);
    expect(broadcast.publishToRoom).toHaveBeenCalledWith(
      `user:${WAITING_GUEST_PARTICIPANT.id}`,
      expect.stringContaining("deny"),
      expect.objectContaining({ participantId: WAITING_GUEST_PARTICIPANT.id }),
    );
    expect(broadcast.publish).toHaveBeenCalledWith(
      MEETING.id,
      expect.stringContaining("deny"),
      expect.objectContaining({ participantId: WAITING_GUEST_PARTICIPANT.id }),
    );
  });
});

describe("ParticipantsService — screen share request/approve/deny", () => {
  describe("requestScreenShare", () => {
    it("broadcasts a request with the caller's own real display name", async () => {
      const { service, broadcast } = makeService();
      await service.requestScreenShare(MEETING.id, PARTICIPANT.userId!, PARTICIPANT.id);
      expect(broadcast.publish).toHaveBeenCalledWith(
        MEETING.id,
        expect.stringContaining("requested"),
        expect.objectContaining({ participantId: PARTICIPANT.id, displayName: "Real Display Name" }),
      );
    });

    it("refuses to request on someone else's behalf", async () => {
      const { service, broadcast } = makeService();
      await expect(service.requestScreenShare(MEETING.id, "someone-else", PARTICIPANT.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(broadcast.publish).not.toHaveBeenCalled();
    });

    it("uses guestName, never the display-name fallback, for a guest's own request", async () => {
      const guest = { ...GUEST_PARTICIPANT, guestName: "Casual Visitor" };
      const { service, broadcast } = makeService({ participant: guest });
      await service.requestScreenShare(MEETING.id, guest.id, guest.id);
      expect(broadcast.publish).toHaveBeenCalledWith(
        MEETING.id,
        expect.stringContaining("requested"),
        expect.objectContaining({ displayName: "Casual Visitor" }),
      );
    });
  });

  describe("approveScreenShare", () => {
    it("requires the screen_share.others.stop capability", async () => {
      const { service, permissions } = makeService();
      await service.approveScreenShare(MEETING.id, "caller-1", PARTICIPANT.id);
      expect(permissions.requireOwnerOrCapability).toHaveBeenCalledWith(
        MEETING.id,
        "caller-1",
        "screen_share.others.stop",
      );
    });

    it("grants the live SFU permission immediately, no reconnect", async () => {
      const { service, liveKit } = makeService();
      await service.approveScreenShare(MEETING.id, "caller-1", PARTICIPANT.id);
      expect(liveKit.updateParticipantPermissions).toHaveBeenCalledWith(
        MEETING.livekitRoomName,
        PARTICIPANT.livekitIdentity,
        { canPublishScreenShare: true },
      );
    });

    it("broadcasts the approval to the room", async () => {
      const { service, broadcast } = makeService();
      await service.approveScreenShare(MEETING.id, "caller-1", PARTICIPANT.id);
      expect(broadcast.publish).toHaveBeenCalledWith(
        MEETING.id,
        expect.stringContaining("approved"),
        { participantId: PARTICIPANT.id },
      );
    });
  });

  describe("denyScreenShare", () => {
    it("requires the screen_share.others.stop capability", async () => {
      const { service, permissions } = makeService();
      await service.denyScreenShare(MEETING.id, "caller-1", PARTICIPANT.id);
      expect(permissions.requireOwnerOrCapability).toHaveBeenCalledWith(
        MEETING.id,
        "caller-1",
        "screen_share.others.stop",
      );
    });

    it("never touches LiveKit — a deny grants nothing", async () => {
      const { service, liveKit } = makeService();
      await service.denyScreenShare(MEETING.id, "caller-1", PARTICIPANT.id);
      expect(liveKit.updateParticipantPermissions).not.toHaveBeenCalled();
    });

    it("broadcasts the denial to the room", async () => {
      const { service, broadcast } = makeService();
      await service.denyScreenShare(MEETING.id, "caller-1", PARTICIPANT.id);
      expect(broadcast.publish).toHaveBeenCalledWith(
        MEETING.id,
        expect.stringContaining("denied"),
        { participantId: PARTICIPANT.id },
      );
    });
  });
});
