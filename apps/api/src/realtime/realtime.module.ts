import { Module } from "@nestjs/common";
import { RealtimeGateway } from "./realtime.gateway";
import { PermissionModule } from "../meetings/permission.module";
import { ChatModule } from "../chat/chat.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { FeatureFlagsModule } from "../feature-flags/feature-flags.module";
import { PresenceModule } from "../presence/presence.module";

@Module({
  imports: [PermissionModule, ChatModule, NotificationsModule, FeatureFlagsModule, PresenceModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
