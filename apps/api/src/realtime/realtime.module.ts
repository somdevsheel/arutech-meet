import { Module } from "@nestjs/common";
import { RealtimeGateway } from "./realtime.gateway";
import { PermissionModule } from "../meetings/permission.module";
import { ChatModule } from "../chat/chat.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [PermissionModule, ChatModule, NotificationsModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
