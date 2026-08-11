import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { RecordingsService } from "./recordings.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { LiveKitService } from "../livekit/livekit.service";
import type { StorageService } from "../storage/storage.service";
import type { PermissionService } from "../meetings/permission.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";

function makeDeps(overrides?: {
  meeting?: Partial<{ id: string; livekitRoomName: string; settings: { allowRecording: boolean } | null }>;
  existingActiveRecording?: unknown;
}) {
  const prisma = {
    client: {
      meeting: {
        findUnique: jest.fn().mockResolvedValue({
          id: "meeting-1",
          livekitRoomName: "meeting-abcd",
          settings: { allowRecording: true },
          ...overrides?.meeting,
        }),
      },
      meetingRecording: {
        findFirst: jest.fn().mockResolvedValue(overrides?.existingActiveRecording ?? null),
        findUnique: jest.fn(),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "rec-1", ...data })),
        update: jest.fn(),
      },
    },
  } as unknown as PrismaService;

  const liveKit = {
    startRoomRecording: jest.fn().mockResolvedValue({ egressId: "egress-1" }),
    stopEgress: jest.fn(),
  } as unknown as LiveKitService;

  const storage = {
    s3Config: { accessKey: "a", secret: "b", region: "r", endpoint: "e", bucket: "buck", forcePathStyle: true },
    getSignedDownloadUrl: jest.fn().mockResolvedValue("https://signed.example/rec.mp4"),
    deleteObject: jest.fn(),
  } as unknown as StorageService;

  const permissions = {
    requireOwnerOrCapability: jest.fn().mockResolvedValue(undefined),
    getParticipant: jest.fn().mockResolvedValue({}),
  } as unknown as PermissionService;

  const broadcast = { publish: jest.fn() } as unknown as RealtimeBroadcastService;

  return { prisma, liveKit, storage, permissions, broadcast };
}

describe("RecordingsService.start", () => {
  it("rejects when the meeting has recording disabled in its settings", async () => {
    const deps = makeDeps({ meeting: { settings: { allowRecording: false } } });
    const service = new RecordingsService(deps.prisma, deps.liveKit, deps.storage, deps.permissions, deps.broadcast);

    await expect(service.start("meeting-1", "host-1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(deps.liveKit.startRoomRecording).not.toHaveBeenCalled();
  });

  it("rejects starting a second recording while one is already active", async () => {
    const deps = makeDeps({ existingActiveRecording: { id: "rec-existing", status: "RECORDING" } });
    const service = new RecordingsService(deps.prisma, deps.liveKit, deps.storage, deps.permissions, deps.broadcast);

    await expect(service.start("meeting-1", "host-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(deps.liveKit.startRoomRecording).not.toHaveBeenCalled();
  });

  it("starts egress and persists a RECORDING row when allowed", async () => {
    const deps = makeDeps();
    const service = new RecordingsService(deps.prisma, deps.liveKit, deps.storage, deps.permissions, deps.broadcast);

    const recording = await service.start("meeting-1", "host-1");

    expect(deps.liveKit.startRoomRecording).toHaveBeenCalledWith(
      "meeting-abcd",
      expect.stringContaining("recordings/meeting-1/"),
      deps.storage.s3Config,
    );
    expect(recording).toMatchObject({ status: "RECORDING", egressId: "egress-1" });
    expect(deps.broadcast.publish).toHaveBeenCalled();
  });
});

describe("RecordingsService.getDownloadUrl", () => {
  it("refuses to sign a URL for a recording that isn't READY yet", async () => {
    const deps = makeDeps();
    (deps.prisma.client.meetingRecording.findUnique as jest.Mock).mockResolvedValue({
      id: "rec-1",
      meetingId: "meeting-1",
      status: "PROCESSING",
      storageKey: "recordings/meeting-1/foo.mp4",
    });
    const service = new RecordingsService(deps.prisma, deps.liveKit, deps.storage, deps.permissions, deps.broadcast);

    await expect(service.getDownloadUrl("meeting-1", "user-1", "rec-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(deps.storage.getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("signs a URL once the recording is READY", async () => {
    const deps = makeDeps();
    (deps.prisma.client.meetingRecording.findUnique as jest.Mock).mockResolvedValue({
      id: "rec-1",
      meetingId: "meeting-1",
      status: "READY",
      storageKey: "recordings/meeting-1/foo.mp4",
    });
    const service = new RecordingsService(deps.prisma, deps.liveKit, deps.storage, deps.permissions, deps.broadcast);

    const result = await service.getDownloadUrl("meeting-1", "user-1", "rec-1");

    expect(result.url).toBe("https://signed.example/rec.mp4");
  });
});
