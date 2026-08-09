import { Module } from "@nestjs/common";
import { RealtimeBroadcastService } from "./realtime-broadcast.service";

@Module({
  providers: [RealtimeBroadcastService],
  exports: [RealtimeBroadcastService],
})
export class RealtimeBroadcastModule {}
