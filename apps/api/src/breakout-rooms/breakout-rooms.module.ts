import { Module } from "@nestjs/common";
import { BreakoutRoomsController } from "./breakout-rooms.controller";
import { BreakoutRoomsService } from "./breakout-rooms.service";
import { PermissionModule } from "../meetings/permission.module";
import { LiveKitModule } from "../livekit/livekit.module";
import { RealtimeBroadcastModule } from "../realtime/realtime-broadcast.module";

@Module({
  imports: [PermissionModule, LiveKitModule, RealtimeBroadcastModule],
  controllers: [BreakoutRoomsController],
  providers: [BreakoutRoomsService],
  exports: [BreakoutRoomsService],
})
export class BreakoutRoomsModule {}
