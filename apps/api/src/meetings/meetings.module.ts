import { Module } from "@nestjs/common";
import { MeetingsController } from "./meetings.controller";
import { MeetingsService } from "./meetings.service";
import { ParticipantsController } from "./participants.controller";
import { ParticipantsService } from "./participants.service";
import { PermissionModule } from "./permission.module";
import { LiveKitModule } from "../livekit/livekit.module";
import { RealtimeBroadcastModule } from "../realtime/realtime-broadcast.module";

@Module({
  imports: [PermissionModule, LiveKitModule, RealtimeBroadcastModule],
  controllers: [MeetingsController, ParticipantsController],
  providers: [MeetingsService, ParticipantsService],
  exports: [MeetingsService],
})
export class MeetingsModule {}
