import { ForbiddenException } from "@nestjs/common";
import { WS_EVENTS } from "@arutech/types";
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
  const broadcast = {
    publish: jest.fn().mockResolvedValue(undefined),
  } as unknown as RealtimeBroadcastService;
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

  // The feature this backs (POST .../breakout-rooms/broadcast — a
  // moderator announcement meant to reach everyone, including people
  // currently inside a breakout room) had zero client-side UI calling it
  // at all until this fix; this method itself was already correct, so
  // these tests just lock in that it stays correct now that it's actually
  // reachable.
  describe("broadcastMessage", () => {
    it("requires breakout.manage before publishing anything", async () => {
      const { service, permissions, broadcast } = makeService();
      (permissions.requireOwnerOrCapability as jest.Mock).mockRejectedValueOnce(
        new ForbiddenException("nope"),
      );
      await expect(service.broadcastMessage("meeting-1", "user-1", "hello")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(broadcast.publish).not.toHaveBeenCalled();
    });

    it("checks the caller against breakout.manage specifically, for this meeting", async () => {
      const { service, permissions } = makeService();
      await service.broadcastMessage("meeting-1", "user-1", "hello everyone");
      expect(permissions.requireOwnerOrCapability).toHaveBeenCalledWith(
        "meeting-1",
        "user-1",
        "breakout.manage",
      );
    });

    it("publishes the exact message to the whole meeting on BREAKOUT_BROADCAST", async () => {
      const { service, broadcast } = makeService();
      await service.broadcastMessage("meeting-1", "user-1", "Back in 2 minutes");
      expect(broadcast.publish).toHaveBeenCalledWith("meeting-1", WS_EVENTS.BREAKOUT_BROADCAST, {
        message: "Back in 2 minutes",
      });
    });
  });
});
