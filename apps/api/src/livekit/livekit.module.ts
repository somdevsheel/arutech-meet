import { Module } from "@nestjs/common";
import { LiveKitService } from "./livekit.service";
import { LiveKitWebhookController } from "./livekit-webhook.controller";
import { MeetingsEventsModule } from "../meetings/meetings-events.module";
import { RecordingsEventsModule } from "../recordings/recordings-events.module";

@Module({
  imports: [MeetingsEventsModule, RecordingsEventsModule],
  controllers: [LiveKitWebhookController],
  providers: [LiveKitService],
  exports: [LiveKitService],
})
export class LiveKitModule {}
