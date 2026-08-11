import { BadRequestException } from "@nestjs/common";
import { PollsService } from "./polls.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { PermissionService } from "../meetings/permission.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";

function makePrismaMock(poll: {
  id: string;
  status: string;
  isMultipleChoice: boolean;
  options: { id: string }[];
  meetingId?: string;
}) {
  return {
    client: {
      poll: { findUnique: jest.fn().mockResolvedValue(poll) },
      pollResponse: { deleteMany: jest.fn(), createMany: jest.fn() },
      pollOption: { findMany: jest.fn().mockResolvedValue([]) },
    },
  } as unknown as PrismaService;
}

function makePermissionsMock(): PermissionService {
  return {
    requireCapability: jest.fn().mockResolvedValue({ role: "PARTICIPANT", participantId: "p1" }),
    getParticipant: jest.fn(),
    requireOwnerOrCapability: jest.fn(),
  } as unknown as PermissionService;
}

function makeBroadcastMock(): RealtimeBroadcastService {
  return { publish: jest.fn() } as unknown as RealtimeBroadcastService;
}

describe("PollsService.respond", () => {
  it("rejects multiple selected options on a single-choice poll", async () => {
    const prisma = makePrismaMock({
      id: "poll-1",
      meetingId: "meeting-1",
      status: "OPEN",
      isMultipleChoice: false,
      options: [{ id: "opt-1" }, { id: "opt-2" }],
    });
    const service = new PollsService(prisma, makePermissionsMock(), makeBroadcastMock());

    await expect(
      service.respond("meeting-1", "user-1", "poll-1", { optionIds: ["opt-1", "opt-2"] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects an option that doesn't belong to the poll", async () => {
    const prisma = makePrismaMock({
      id: "poll-1",
      meetingId: "meeting-1",
      status: "OPEN",
      isMultipleChoice: true,
      options: [{ id: "opt-1" }],
    });
    const service = new PollsService(prisma, makePermissionsMock(), makeBroadcastMock());

    await expect(
      service.respond("meeting-1", "user-1", "poll-1", { optionIds: ["not-a-real-option"] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects responding to a closed poll", async () => {
    const prisma = makePrismaMock({
      id: "poll-1",
      meetingId: "meeting-1",
      status: "CLOSED",
      isMultipleChoice: true,
      options: [{ id: "opt-1" }],
    });
    const service = new PollsService(prisma, makePermissionsMock(), makeBroadcastMock());

    await expect(
      service.respond("meeting-1", "user-1", "poll-1", { optionIds: ["opt-1"] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
