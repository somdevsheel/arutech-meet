import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { RealtimeBroadcastModule } from "../realtime/realtime-broadcast.module";

@Module({
  imports: [RealtimeBroadcastModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
