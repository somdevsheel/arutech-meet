import { BadRequestException } from "@nestjs/common";
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

function makeService(overrides?: { participant?: typeof PARTICIPANT | typeof GUEST_PARTICIPANT }) {
  const participant = overrides?.participant ?? PARTICIPANT;
  const prisma = {
    client: {
      meetingParticipant: {
        findUnique: jest.fn().mockResolvedValue(participant),
        update: jest.fn().mockResolvedValue({ ...participant, status: "REMOVED" }),
      },
      meeting: { findUniqueOrThrow: jest.fn().mockResolvedValue(MEETING) },
      meetingEvent: { create: jest.fn().mockResolvedValue(undefined) },
    },
  } as unknown as PrismaService;
  const liveKit = { removeParticipant: jest.fn().mockResolvedValue(undefined) } as unknown as LiveKitService;
  const permissions = { requireOwnerOrCapability: jest.fn().mockResolvedValue(undefined) } as unknown as PermissionService;
  const broadcast = { publish: jest.fn().mockResolvedValue(undefined) } as unknown as RealtimeBroadcastService;
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
