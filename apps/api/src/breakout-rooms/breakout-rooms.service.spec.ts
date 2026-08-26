import { ForbiddenException } from "@nestjs/common";
import { BreakoutRoomsService } from "./breakout-rooms.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { LiveKitService } from "../livekit/livekit.service";
import type { PermissionService } from "../meetings/permission.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import type { FeatureFlagsService } from "../feature-flags/feature-flags.service";

const MEETING = { id: "meeting-1", orgId: null, livekitRoomName: "room-1" };

function makeService(overrides?: { breakoutRoomsEnabled?: boolean }) {
  const prisma = {
    client: {
      meeting: { findUniqueOrThrow: jest.fn().mockResolvedValue(MEETING) },
      $transaction: jest.fn().mockResolvedValue([]),
      meetingParticipant: { findMany: jest.fn().mockResolvedValue([]) },
      breakoutRoomAssignment: { createMany: jest.fn() },
      breakoutRoom: {
        create: jest.fn().mockResolvedValue({ id: "room-1", name: "Room 1" }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    },
  } as unknown as PrismaService;
  const liveKit = {} as unknown as LiveKitService;
  const permissions = {
    requireOwnerOrCapability: jest.fn().mockResolvedValue(undefined),
    getParticipant: jest.fn().mockResolvedValue({ role: "PARTICIPANT" }),
  } as unknown as PermissionService;
  const broadcast = { publish: jest.fn().mockResolvedValue(undefined) } as unknown as RealtimeBroadcastService;
  const featureFlags = {
    isEnabled: jest.fn().mockResolvedValue(overrides?.breakoutRoomsEnabled ?? true),
  } as unknown as FeatureFlagsService;

  const service = new BreakoutRoomsService(prisma, liveKit, permissions, broadcast, featureFlags);
  return { service, prisma, permissions, broadcast, featureFlags };
}

describe("BreakoutRoomsService", () => {
  describe("create", () => {
    it("checks the BREAKOUT_ROOMS feature flag against the meeting's org", async () => {
      const { service, featureFlags } = makeService();
      await service.create("meeting-1", "user-1", { names: ["Room 1"], autoAssign: false });
      expect(featureFlags.isEnabled).toHaveBeenCalledWith("BREAKOUT_ROOMS", MEETING.orgId);
    });

    it("refuses to create any rooms when the flag is disabled", async () => {
      const { service, prisma, broadcast } = makeService({ breakoutRoomsEnabled: false });
      await expect(
        service.create("meeting-1", "user-1", { names: ["Room 1"], autoAssign: false }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
      expect(broadcast.publish).not.toHaveBeenCalled();
    });
  });
});
