import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { WS_EVENTS } from "@arutech/types";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitService } from "../livekit/livekit.service";
import { StorageService } from "../storage/storage.service";
import { PermissionService } from "../meetings/permission.service";
import { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import { AuditLogService } from "../audit/audit-log.service";

const RETENTION_DAYS = 90;

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly liveKit: LiveKitService,
    private readonly storage: StorageService,
    private readonly permissions: PermissionService,
    private readonly broadcast: RealtimeBroadcastService,
    private readonly auditLog: AuditLogService,
  ) {}

  async start(meetingId: string, callerUserId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "recording.start");
    const meeting = await this.prisma.client.meeting.findUnique({
      where: { id: meetingId },
      include: { settings: true },
    });
    if (!meeting) throw new NotFoundException("Meeting not found");
    if (!meeting.settings?.allowRecording) {
      throw new ForbiddenException("Recording is disabled for this meeting");
    }

    const existing = await this.prisma.client.meetingRecording.findFirst({
      where: { meetingId, status: { in: ["PENDING", "RECORDING"] } },
    });
    if (existing) throw new BadRequestException("A recording is already in progress");

    const filepath = `recordings/${meetingId}/${Date.now()}-${randomUUID()}.mp4`;
    const egress = await this.liveKit.startRoomRecording(
      meeting.livekitRoomName,
      filepath,
      this.storage.s3Config,
    );

    const recording = await this.prisma.client.meetingRecording.create({
      data: {
        meetingId,
        startedByUserId: callerUserId,
        status: "RECORDING",
        egressId: egress.egressId,
        storageKey: filepath,
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    await this.broadcast.publish(meetingId, WS_EVENTS.RECORDING_STARTED, { recordingId: recording.id });
    return recording;
  }

  async stop(meetingId: string, callerUserId: string, recordingId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "recording.stop");
    const recording = await this.getOrThrow(meetingId, recordingId);
    if (recording.status !== "RECORDING") {
      throw new BadRequestException("This recording is not active");
    }
    if (!recording.egressId) throw new BadRequestException("Recording has no associated egress job");

    await this.liveKit.stopEgress(recording.egressId);
    const updated = await this.prisma.client.meetingRecording.update({
      where: { id: recordingId },
      data: { status: "PROCESSING", processingStartedAt: new Date() },
    });

    await this.broadcast.publish(meetingId, WS_EVENTS.RECORDING_STOPPED, { recordingId });
    return updated;
  }

  async list(meetingId: string, callerUserId: string) {
    await this.permissions.getParticipant(meetingId, callerUserId);
    return this.prisma.client.meetingRecording.findMany({
      where: { meetingId, deletedAt: null },
      orderBy: { startedAt: "desc" },
    });
  }

  /** Cross-meeting recordings list for the "Recent recordings" home page card —
   * every READY recording from a meeting the caller owned or attended, newest
   * first. Unlike `list()` this isn't scoped to one meeting, so authorization is
   * just "this recording's meeting involved you" rather than a capability check. */
  async listMine(callerUserId: string) {
    return this.prisma.client.meetingRecording.findMany({
      where: {
        deletedAt: null,
        status: "READY",
        meeting: {
          deletedAt: null,
          OR: [{ ownerId: callerUserId }, { participants: { some: { userId: callerUserId } } }],
        },
      },
      include: { meeting: { select: { title: true, code: true } } },
      orderBy: { startedAt: "desc" },
      take: 6,
    });
  }

  async getDownloadUrl(meetingId: string, callerUserId: string, recordingId: string) {
    await this.permissions.getParticipant(meetingId, callerUserId);
    const recording = await this.getOrThrow(meetingId, recordingId);
    if (recording.status !== "READY" || !recording.storageKey) {
      throw new BadRequestException("Recording is not ready for playback yet");
    }
    const url = await this.storage.getSignedDownloadUrl(recording.storageKey);
    return { url, expiresInSeconds: 600 };
  }

  async remove(meetingId: string, callerUserId: string, recordingId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "recording.delete");
    const recording = await this.getOrThrow(meetingId, recordingId);

    if (recording.storageKey) {
      try {
        await this.storage.deleteObject(recording.storageKey);
      } catch (err) {
        this.logger.warn(`Failed to delete storage object for recording ${recordingId}: ${String(err)}`);
      }
    }
    await this.prisma.client.meetingRecording.update({
      where: { id: recordingId },
      data: { status: "DELETED", deletedAt: new Date() },
    });
    await this.auditLog.record({
      actorUserId: callerUserId,
      action: "recording.delete",
      targetType: "meeting_recording",
      targetId: recordingId,
      metadata: { meetingId },
    });
  }

  private async getOrThrow(meetingId: string, recordingId: string) {
    const recording = await this.prisma.client.meetingRecording.findUnique({ where: { id: recordingId } });
    if (!recording || recording.meetingId !== meetingId) throw new NotFoundException("Recording not found");
    return recording;
  }
}
