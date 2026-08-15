import { Module } from "@nestjs/common";
import { RecordingsEventsService } from "./recordings-events.service";
import { RealtimeBroadcastModule } from "../realtime/realtime-broadcast.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [RealtimeBroadcastModule, NotificationsModule],
  providers: [RecordingsEventsService],
  exports: [RecordingsEventsService],
})
export class RecordingsEventsModule {}
