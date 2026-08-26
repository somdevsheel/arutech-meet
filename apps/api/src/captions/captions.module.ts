import { Module } from "@nestjs/common";
import { CaptionsController } from "./captions.controller";
import { CaptionsService } from "./captions.service";
import { PermissionModule } from "../meetings/permission.module";
import { LiveKitModule } from "../livekit/livekit.module";
import { RealtimeBroadcastModule } from "../realtime/realtime-broadcast.module";
import { FeatureFlagsModule } from "../feature-flags/feature-flags.module";

@Module({
  imports: [PermissionModule, LiveKitModule, RealtimeBroadcastModule, FeatureFlagsModule],
  controllers: [CaptionsController],
  providers: [CaptionsService],
})
export class CaptionsModule {}
