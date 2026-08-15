import { BadRequestException, Controller, Headers, Logger, Post, Req } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { EgressStatus } from "livekit-server-sdk";
import type { Request } from "express";
import { LiveKitService } from "./livekit.service";
import { Public } from "../common/decorators/public.decorator";
import { MeetingsEventsService } from "../meetings/meetings-events.service";
import { RecordingsEventsService } from "../recordings/recordings-events.service";

/**
 * Receives server-to-server webhooks from the LiveKit SFU (participant joined/left,
 * room started/finished, track published, egress state changes). This is how the
 * application backend learns about media-plane events without being in the media path.
 * Auth is the LiveKit webhook signature (verified via WebhookReceiver), not a JWT —
 * hence @Public() — but every payload is cryptographically verified before use.
 */
@ApiExcludeController()
@Controller("livekit/webhook")
export class LiveKitWebhookController {
  private readonly logger = new Logger(LiveKitWebhookController.name);

  constructor(
    private readonly liveKit: LiveKitService,
    private readonly meetingEvents: MeetingsEventsService,
    private readonly recordingEvents: RecordingsEventsService,
  ) {}

  @Public()
  @Post()
  async handle(@Req() req: Request & { rawBody?: Buffer }, @Headers("authorization") auth?: string) {
    if (!auth || !req.rawBody) {
      throw new BadRequestException("Missing webhook signature or body");
    }

    const event = await this.liveKit.receiveWebhook(req.rawBody.toString("utf8"), auth);
    this.logger.debug(`LiveKit webhook: ${event.event} room=${event.room?.name ?? event.egressInfo?.roomName ?? "?"}`);

    if (event.event.startsWith("egress_") && event.egressInfo) {
      await this.handleEgressEvent(event.egressInfo);
    } else {
      await this.meetingEvents.handleLiveKitWebhook(event);
    }
    return { received: true };
  }

  private async handleEgressEvent(egressInfo: {
    egressId: string;
    status: EgressStatus;
    fileResults: { location: string; size: bigint; duration: bigint }[];
  }) {
    // FileInfo.duration is a raw int64 with no unit documented on the generated
    // type; LiveKit's egress service is implemented in Go using time.Duration
    // internally (nanoseconds), which is the convention followed here — confirmed
    // correct against a real completed egress (see docs/roadmap.md §Recording).
    const file = egressInfo.fileResults[0];
    const fileSummary = file
      ? { location: file.location, sizeBytes: Number(file.size), durationSeconds: Number(file.duration) / 1_000_000_000 }
      : undefined;

    switch (egressInfo.status) {
      case EgressStatus.EGRESS_STARTING:
      case EgressStatus.EGRESS_ACTIVE:
        await this.recordingEvents.handleEgressUpdate(egressInfo.egressId, "RECORDING");
        break;
      case EgressStatus.EGRESS_ENDING:
        await this.recordingEvents.handleEgressUpdate(egressInfo.egressId, "PROCESSING");
        break;
      case EgressStatus.EGRESS_COMPLETE:
        await this.recordingEvents.handleEgressUpdate(egressInfo.egressId, "READY", fileSummary);
        break;
      case EgressStatus.EGRESS_FAILED:
      case EgressStatus.EGRESS_ABORTED:
      case EgressStatus.EGRESS_LIMIT_REACHED:
        await this.recordingEvents.handleEgressUpdate(egressInfo.egressId, "FAILED");
        break;
    }
  }
}
