import { Injectable, Logger } from "@nestjs/common";
import { WS_EVENTS } from "@arutech/types";
import { PrismaService } from "../prisma/prisma.service";
import { MetricsService } from "../observability/metrics.service";
import { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import { NotificationsService } from "../notifications/notifications.service";

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
    private readonly broadcast: RealtimeBroadcastService,
    private readonly notifications: NotificationsService,
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

    // RECORDING_STARTED/STOPPED (broadcast by RecordingsService) only cover the
    // user-initiated start/stop edges — this covers the webhook-driven
    // PROCESSING -> READY/FAILED transition that happens well after the user
    // clicks "Stop", which otherwise has no way to reach an open RecordingsPanel.
    await this.broadcast.publish(recording.meetingId, WS_EVENTS.RECORDING_UPDATED, {
      recordingId: recording.id,
      status,
    });

    if (status === "FAILED") {
      this.metrics.recordingFailuresTotal.inc();
    }

    if (status === "READY") {
      // Routed through NotificationsService (not a raw prisma.notification.create)
      // so this also pushes a real-time NOTIFICATION_CREATED event — previously
      // this row was written but nothing ever read it back or knew it existed.
      await this.notifications.create({
        userId: recording.startedByUserId,
        type: "RECORDING_READY",
        title: "Your recording is ready",
        body: "The meeting recording you started has finished processing and is ready to view.",
        data: { meetingId: recording.meetingId, recordingId: recording.id },
      });
    }
  }
}
