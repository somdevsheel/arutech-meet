import { BadRequestException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { RecordingsService } from "./recordings.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { LiveKitService } from "../livekit/livekit.service";
import type { StorageService } from "../storage/storage.service";
import type { PermissionService } from "../meetings/permission.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import type { AuditLogService } from "../audit/audit-log.service";

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
  const auditLog = { record: jest.fn() } as unknown as AuditLogService;

  return { prisma, liveKit, storage, permissions, broadcast, auditLog };
}

describe("RecordingsService.start", () => {
  it("rejects when the meeting has recording disabled in its settings", async () => {
    const deps = makeDeps({ meeting: { settings: { allowRecording: false } } });
    const service = new RecordingsService(deps.prisma, deps.liveKit, deps.storage, deps.permissions, deps.broadcast, deps.auditLog);

    await expect(service.start("meeting-1", "host-1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(deps.liveKit.startRoomRecording).not.toHaveBeenCalled();
  });

  it("rejects starting a second recording while one is already active", async () => {
    const deps = makeDeps({ existingActiveRecording: { id: "rec-existing", status: "RECORDING" } });
    const service = new RecordingsService(deps.prisma, deps.liveKit, deps.storage, deps.permissions, deps.broadcast, deps.auditLog);

    await expect(service.start("meeting-1", "host-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(deps.liveKit.startRoomRecording).not.toHaveBeenCalled();
  });

  it("starts egress and persists a RECORDING row when allowed", async () => {
    const deps = makeDeps();
    const service = new RecordingsService(deps.prisma, deps.liveKit, deps.storage, deps.permissions, deps.broadcast, deps.auditLog);

    const recording = await service.start("meeting-1", "host-1");

    expect(deps.liveKit.startRoomRecording).toHaveBeenCalledWith(
      "meeting-abcd",
      expect.stringContaining("recordings/meeting-1/"),
      deps.storage.s3Config,
    );
    expect(recording).toMatchObject({ status: "RECORDING", egressId: "egress-1" });
    expect(deps.broadcast.publish).toHaveBeenCalled();
  });

  // M-5: a slow/unreachable egress worker made this hang for LiveKit's own
  // client-side timeout (~10s) and then throw a raw, non-HttpException
  // error — that used to reach AllExceptionsFilter's generic catch-all and
  // come back as a bare "Internal server error" with zero indication this
  // was the recording infrastructure. Real coverage for the actual fix.
  it("turns a LiveKit egress failure into a clear, actionable error instead of a raw one", async () => {
    const deps = makeDeps();
    (deps.liveKit.startRoomRecording as jest.Mock).mockRejectedValue(new Error("TimeoutError"));
    const service = new RecordingsService(deps.prisma, deps.liveKit, deps.storage, deps.permissions, deps.broadcast, deps.auditLog);

    const result = service.start("meeting-1", "host-1");

    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(result).rejects.toThrow(/recording service didn't respond/i);
    expect(deps.prisma.client.meetingRecording.create).not.toHaveBeenCalled();
  });
});

describe("RecordingsService.stop", () => {
  function makeActiveRecording(overrides?: Partial<{ status: string; egressId: string | null }>) {
    return {
      id: "rec-1",
      meetingId: "meeting-1",
      status: "RECORDING",
      egressId: "egress-1",
      ...overrides,
    };
  }

  it("stops egress and marks the recording PROCESSING", async () => {
    const deps = makeDeps();
    (deps.prisma.client.meetingRecording.findUnique as jest.Mock).mockResolvedValue(makeActiveRecording());
    (deps.prisma.client.meetingRecording.update as jest.Mock).mockImplementation(({ data }) =>
      Promise.resolve({ ...makeActiveRecording(), ...data }),
    );
    const service = new RecordingsService(deps.prisma, deps.liveKit, deps.storage, deps.permissions, deps.broadcast, deps.auditLog);

    const result = await service.stop("meeting-1", "host-1", "rec-1");

    expect(deps.liveKit.stopEgress).toHaveBeenCalledWith("egress-1");
    expect(result.status).toBe("PROCESSING");
    expect(deps.broadcast.publish).toHaveBeenCalled();
  });

  // M-5: same failure class as start() above — stopEgress can hang and
  // throw the same raw error.
  it("turns a LiveKit stopEgress failure into a clear, actionable error instead of a raw one", async () => {
    const deps = makeDeps();
    (deps.prisma.client.meetingRecording.findUnique as jest.Mock).mockResolvedValue(makeActiveRecording());
    (deps.liveKit.stopEgress as jest.Mock).mockRejectedValue(new Error("TimeoutError"));
    const service = new RecordingsService(deps.prisma, deps.liveKit, deps.storage, deps.permissions, deps.broadcast, deps.auditLog);

    const result = service.stop("meeting-1", "host-1", "rec-1");

    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(result).rejects.toThrow(/recording service didn't respond/i);
    expect(deps.prisma.client.meetingRecording.update).not.toHaveBeenCalled();
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
    const service = new RecordingsService(deps.prisma, deps.liveKit, deps.storage, deps.permissions, deps.broadcast, deps.auditLog);

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
    const service = new RecordingsService(deps.prisma, deps.liveKit, deps.storage, deps.permissions, deps.broadcast, deps.auditLog);

    const result = await service.getDownloadUrl("meeting-1", "user-1", "rec-1");

    expect(result.url).toBe("https://signed.example/rec.mp4");
  });
});
