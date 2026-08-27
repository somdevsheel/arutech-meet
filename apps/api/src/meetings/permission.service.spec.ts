import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { PermissionService } from "./permission.service";
import type { PrismaService } from "../prisma/prisma.service";

function makePrismaMock() {
  return {
    client: {
      meetingParticipant: { findFirst: jest.fn() },
      meeting: { findUnique: jest.fn() },
    },
  } as unknown as PrismaService;
}

describe("PermissionService", () => {
  describe("getParticipant", () => {
    it("throws NotFoundException when the caller has no participant row", async () => {
      const prisma = makePrismaMock();
      (prisma.client.meetingParticipant.findFirst as jest.Mock).mockResolvedValue(null);
      const service = new PermissionService(prisma);

      await expect(service.getParticipant("meeting-1", "user-1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it.each(["WAITING", "INVITED", "DENIED", "REMOVED", "LEFT"] as const)(
      "throws ForbiddenException when the participant's status is %s",
      async (status) => {
        const prisma = makePrismaMock();
        (prisma.client.meetingParticipant.findFirst as jest.Mock).mockResolvedValue({
          id: "p1",
          role: "PARTICIPANT",
          status,
        });
        const service = new PermissionService(prisma);

        await expect(service.getParticipant("meeting-1", "user-1")).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      },
    );

    it.each(["ADMITTED", "JOINED"] as const)(
      "returns the participant when status is %s",
      async (status) => {
        const prisma = makePrismaMock();
        (prisma.client.meetingParticipant.findFirst as jest.Mock).mockResolvedValue({
          id: "p1",
          role: "PARTICIPANT",
          status,
        });
        const service = new PermissionService(prisma);

        await expect(service.getParticipant("meeting-1", "user-1")).resolves.toMatchObject({
          id: "p1",
        });
      },
    );
  });

  describe("requireCapability", () => {
    it("rejects when the caller's role lacks the capability", async () => {
      const prisma = makePrismaMock();
      (prisma.client.meetingParticipant.findFirst as jest.Mock).mockResolvedValue({
        id: "p1",
        role: "PARTICIPANT",
        status: "JOINED",
      });
      const service = new PermissionService(prisma);

      await expect(
        service.requireCapability("meeting-1", "user-1", "participant.remove"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("resolves with the role when the capability is granted", async () => {
      const prisma = makePrismaMock();
      (prisma.client.meetingParticipant.findFirst as jest.Mock).mockResolvedValue({
        id: "p1",
        role: "HOST",
        status: "JOINED",
      });
      const service = new PermissionService(prisma);

      await expect(
        service.requireCapability("meeting-1", "user-1", "participant.remove"),
      ).resolves.toEqual({ role: "HOST", participantId: "p1" });
    });
  });

  describe("requireOwnerOrCapability", () => {
    it("allows the meeting owner regardless of their participant role", async () => {
      const prisma = makePrismaMock();
      (prisma.client.meeting.findUnique as jest.Mock).mockResolvedValue({ ownerId: "user-1" });
      const service = new PermissionService(prisma);

      await expect(
        service.requireOwnerOrCapability("meeting-1", "user-1", "meeting.end"),
      ).resolves.toBeUndefined();
      expect(prisma.client.meetingParticipant.findFirst).not.toHaveBeenCalled();
    });

    it("falls back to the capability check for non-owners", async () => {
      const prisma = makePrismaMock();
      (prisma.client.meeting.findUnique as jest.Mock).mockResolvedValue({ ownerId: "owner-1" });
      (prisma.client.meetingParticipant.findFirst as jest.Mock).mockResolvedValue({
        id: "p1",
        role: "GUEST",
        status: "JOINED",
      });
      const service = new PermissionService(prisma);

      await expect(
        service.requireOwnerOrCapability("meeting-1", "user-2", "meeting.end"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("throws NotFoundException when the meeting does not exist", async () => {
      const prisma = makePrismaMock();
      (prisma.client.meeting.findUnique as jest.Mock).mockResolvedValue(null);
      const service = new PermissionService(prisma);

      await expect(
        service.requireOwnerOrCapability("missing", "user-1", "meeting.end"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
