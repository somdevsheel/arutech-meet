import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MetricsService } from "../observability/metrics.service";

/**
 * Standalone from RecordingsService (which needs LiveKit/Storage/Permissions —
 * see recordings.module.ts) purely to avoid a module cycle: LiveKitModule needs
 * to call into this on egress_* webhooks, and RecordingsModule needs LiveKitModule
 * for starting/stopping egress jobs. Same split as MeetingsEventsService vs.
 * MeetingsModule (see meetings-events.module.ts) for the identical reason.
 */
@Injectable()
export class RecordingsEventsService {
  private readonly logger = new Logger(RecordingsEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  /** Called by LiveKitWebhookController in response to egress_started/updated/ended —
   * this is how a recording actually transitions PROCESSING -> READY/FAILED, since
   * the encoding + S3 upload happens entirely inside the egress worker, not here. */
  async handleEgressUpdate(
    egressId: string,
    status: "RECORDING" | "PROCESSING" | "READY" | "FAILED",
    file?: { location: string; sizeBytes: number; durationSeconds: number },
  ): Promise<void> {
    const recording = await this.prisma.client.meetingRecording.findFirst({ where: { egressId } });
    if (!recording) {
      this.logger.debug(`No MeetingRecording found for egressId ${egressId}`);
      return;
    }

    await this.prisma.client.meetingRecording.update({
      where: { id: recording.id },
      data: {
        status,
        sizeBytes: file?.sizeBytes,
        durationSeconds: file?.durationSeconds,
        readyAt: status === "READY" ? new Date() : undefined,
        endedAt: status === "READY" || status === "FAILED" ? new Date() : undefined,
      },
    });

    if (status === "FAILED") {
      this.metrics.recordingFailuresTotal.inc();
    }

    if (status === "READY") {
      await this.prisma.client.notification.create({
        data: {
          userId: recording.startedByUserId,
          type: "RECORDING_READY",
          channel: "IN_APP",
          title: "Your recording is ready",
          body: "The meeting recording you started has finished processing and is ready to view.",
          data: { meetingId: recording.meetingId, recordingId: recording.id },
        },
      });
    }
  }
}
