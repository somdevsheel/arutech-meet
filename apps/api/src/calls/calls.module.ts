import { Module } from "@nestjs/common";
import { CallsController } from "./calls.controller";
import { CallsService } from "./calls.service";
import { LiveKitModule } from "../livekit/livekit.module";
import { RealtimeBroadcastModule } from "../realtime/realtime-broadcast.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ContactsModule } from "../contacts/contacts.module";

@Module({
  imports: [LiveKitModule, RealtimeBroadcastModule, NotificationsModule, ContactsModule],
  controllers: [CallsController],
  providers: [CallsService],
  exports: [CallsService],
})
export class CallsModule {}
