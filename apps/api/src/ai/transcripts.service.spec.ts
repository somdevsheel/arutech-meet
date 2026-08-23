import { BadRequestException, NotFoundException } from "@nestjs/common";
import { TranscriptsService } from "./transcripts.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import type { PermissionService } from "../meetings/permission.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import type { AuditLogService } from "../audit/audit-log.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { MetricsService } from "../observability/metrics.service";
import type { TranscriptionProvider } from "./providers/transcription-provider.interface";
import type { SummarizationProvider } from "./providers/summarization-provider.interface";

function makeDeps(overrides?: {
  recording?: Partial<{ id: string; meetingId: string; status: string; storageKey: string | null }> | null;
  existingTranscript?: unknown;
}) {
  const readyRecording = {
    id: "rec-1",
    meetingId: "meeting-1",
    status: "READY",
    storageKey: "recordings/meeting-1/foo.mp4",
    startedByUserId: "host-1",
    ...overrides?.recording,
  };

  const prisma = {
    client: {
      meetingRecording: {
        findUnique: jest.fn().mockResolvedValue(overrides?.recording === null ? null : readyRecording),
        findFirst: jest.fn().mockResolvedValue(overrides?.recording === null ? null : readyRecording),
      },
      meetingTranscript: {
        findFirst: jest.fn().mockResolvedValue(overrides?.existingTranscript ?? null),
        findUnique: jest.fn(),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "transcript-1", ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "transcript-1", meetingId: "meeting-1", recordingId: "rec-1", ...data })),
        delete: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      transcriptSegment: {
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      aiSummary: { create: jest.fn() },
    },
  } as unknown as PrismaService;

  const storage = { downloadToFile: jest.fn() } as unknown as StorageService;

  const permissions = {
    requireOwnerOrCapability: jest.fn().mockResolvedValue(undefined),
    getParticipant: jest.fn().mockResolvedValue({}),
  } as unknown as PermissionService;

  const broadcast = { publish: jest.fn() } as unknown as RealtimeBroadcastService;
  const auditLog = { record: jest.fn() } as unknown as AuditLogService;
  const notifications = { create: jest.fn() } as unknown as NotificationsService;
  const metrics = {
    transcriptionFailuresTotal: { inc: jest.fn() },
    transcriptionDurationSeconds: { observe: jest.fn() },
  } as unknown as MetricsService;

  const transcriptionProvider = { name: "openai", transcribe: jest.fn() } as unknown as TranscriptionProvider;
  const summarizationProvider = { name: "openai", summarize: jest.fn() } as unknown as SummarizationProvider;

  return {
    prisma,
    storage,
    permissions,
    broadcast,
    auditLog,
    notifications,
    metrics,
    transcriptionProvider,
    summarizationProvider,
  };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new TranscriptsService(
    deps.prisma,
    deps.storage,
    deps.permissions,
    deps.broadcast,
    deps.auditLog,
    deps.notifications,
    deps.metrics,
    deps.transcriptionProvider,
    deps.summarizationProvider,
  );
}

describe("TranscriptsService.generate", () => {
  it("rejects when no matching recording exists for the meeting", async () => {
    const deps = makeDeps({ recording: null });
    const service = makeService(deps);

    await expect(service.generate("meeting-1", "host-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects when the recording hasn't finished processing yet", async () => {
    const deps = makeDeps({ recording: { status: "PROCESSING" } });
    const service = makeService(deps);

    await expect(service.generate("meeting-1", "host-1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects when a transcript is already being generated for this recording", async () => {
    const deps = makeDeps({ existingTranscript: { id: "existing", status: "PROCESSING" } });
    const service = makeService(deps);

    await expect(service.generate("meeting-1", "host-1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("checks the transcript.generate capability before creating anything", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.generate("meeting-1", "host-1");

    expect(deps.permissions.requireOwnerOrCapability).toHaveBeenCalledWith(
      "meeting-1",
      "host-1",
      "transcript.generate",
    );
  });

  it("creates a PENDING transcript row and returns immediately without awaiting the pipeline", async () => {
    const deps = makeDeps();
    (deps.transcriptionProvider.transcribe as jest.Mock).mockImplementation(
      () => new Promise(() => undefined), // never resolves — proves generate() doesn't await it
    );
    const service = makeService(deps);

    const result = await service.generate("meeting-1", "host-1");

    expect(result).toMatchObject({ status: "PENDING", meetingId: "meeting-1", recordingId: "rec-1" });
  });

  it("rejects a recordingId belonging to a different meeting", async () => {
    const deps = makeDeps({ recording: { meetingId: "other-meeting" } });
    const service = makeService(deps);

    await expect(service.generate("meeting-1", "host-1", "rec-1")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("TranscriptsService.search", () => {
  it("returns an empty array for a too-short query without hitting the database", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    const result = await service.search("meeting-1", "user-1", "a");

    expect(result).toEqual([]);
    expect(deps.prisma.client.transcriptSegment.findMany).not.toHaveBeenCalled();
  });

  it("checks meeting participation before searching", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.search("meeting-1", "user-1", "budget");

    expect(deps.permissions.getParticipant).toHaveBeenCalledWith("meeting-1", "user-1");
    expect(deps.prisma.client.transcriptSegment.findMany).toHaveBeenCalled();
  });
});

describe("TranscriptsService.remove", () => {
  it("requires the transcript.delete capability, not just transcript.generate", async () => {
    const deps = makeDeps();
    (deps.prisma.client.meetingTranscript.findUnique as jest.Mock).mockResolvedValue({
      id: "transcript-1",
      meetingId: "meeting-1",
    });
    const service = makeService(deps);

    await service.remove("meeting-1", "host-1", "transcript-1");

    expect(deps.permissions.requireOwnerOrCapability).toHaveBeenCalledWith(
      "meeting-1",
      "host-1",
      "transcript.delete",
    );
    expect(deps.auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "transcript.delete", targetId: "transcript-1" }),
    );
  });

  it("404s on a transcript from a different meeting", async () => {
    const deps = makeDeps();
    (deps.prisma.client.meetingTranscript.findUnique as jest.Mock).mockResolvedValue({
      id: "transcript-1",
      meetingId: "other-meeting",
    });
    const service = makeService(deps);

    await expect(service.remove("meeting-1", "host-1", "transcript-1")).rejects.toBeInstanceOf(NotFoundException);
  });
});
