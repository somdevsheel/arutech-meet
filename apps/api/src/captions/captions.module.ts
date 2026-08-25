import { Module } from "@nestjs/common";
import { CaptionsController } from "./captions.controller";
import { CaptionsService } from "./captions.service";
import { PermissionModule } from "../meetings/permission.module";
import { LiveKitModule } from "../livekit/livekit.module";
import { RealtimeBroadcastModule } from "../realtime/realtime-broadcast.module";

@Module({
  imports: [PermissionModule, LiveKitModule, RealtimeBroadcastModule],
  controllers: [CaptionsController],
  providers: [CaptionsService],
})
export class CaptionsModule {}
