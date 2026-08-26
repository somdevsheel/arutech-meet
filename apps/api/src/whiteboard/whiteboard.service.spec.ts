import { ForbiddenException } from "@nestjs/common";
import { WhiteboardService } from "./whiteboard.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { PermissionService } from "../meetings/permission.service";
import type { FeatureFlagsService } from "../feature-flags/feature-flags.service";

function makeService(overrides?: { whiteboardEnabled?: boolean; existingWhiteboard?: unknown }) {
  const prisma = {
    client: {
      whiteboard: {
        findFirst: jest.fn().mockResolvedValue(overrides?.existingWhiteboard ?? null),
        create: jest.fn().mockResolvedValue({ id: "wb-1", pages: [] }),
      },
      whiteboardPage: {
        upsert: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
    },
  } as unknown as PrismaService;
  const permissions = {
    getParticipant: jest.fn().mockResolvedValue({ role: "PARTICIPANT" }),
    requireCapability: jest.fn().mockResolvedValue(undefined),
  } as unknown as PermissionService;
  const featureFlags = {
    isEnabledForMeeting: jest.fn().mockResolvedValue(overrides?.whiteboardEnabled ?? true),
  } as unknown as FeatureFlagsService;

  const service = new WhiteboardService(prisma, permissions, featureFlags);
  return { service, prisma, permissions, featureFlags };
}

describe("WhiteboardService", () => {
  describe("getOrCreate", () => {
    it("checks the WHITEBOARD feature flag for this meeting", async () => {
      const { service, featureFlags } = makeService();
      await service.getOrCreate("meeting-1", "user-1");
      expect(featureFlags.isEnabledForMeeting).toHaveBeenCalledWith("WHITEBOARD", "meeting-1");
    });

    it("refuses to create/return a whiteboard when the flag is disabled for this meeting", async () => {
      const { service, prisma } = makeService({ whiteboardEnabled: false });
      await expect(service.getOrCreate("meeting-1", "user-1")).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.client.whiteboard.create).not.toHaveBeenCalled();
      expect(prisma.client.whiteboard.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("savePage / addPage", () => {
    it("also refuse when disabled, since both call getOrCreate internally", async () => {
      const { service } = makeService({ whiteboardEnabled: false });
      await expect(
        service.savePage("meeting-1", "user-1", { pageIndex: 0, data: {} }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.addPage("meeting-1", "user-1")).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
