import { BadRequestException, Controller, Headers, Logger, Post, Req } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request } from "express";
import { LiveKitService } from "./livekit.service";
import { Public } from "../common/decorators/public.decorator";
import { MeetingsEventsService } from "../meetings/meetings-events.service";

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
  ) {}

  @Public()
  @Post()
  async handle(@Req() req: Request & { rawBody?: Buffer }, @Headers("authorization") auth?: string) {
    if (!auth || !req.rawBody) {
      throw new BadRequestException("Missing webhook signature or body");
    }

    const event = await this.liveKit.receiveWebhook(req.rawBody.toString("utf8"), auth);
    this.logger.debug(`LiveKit webhook: ${event.event} room=${event.room?.name ?? "?"}`);

    await this.meetingEvents.handleLiveKitWebhook(event);
    return { received: true };
  }
}
