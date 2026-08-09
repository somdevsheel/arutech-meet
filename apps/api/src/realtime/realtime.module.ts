import { Module } from "@nestjs/common";
import { RealtimeGateway } from "./realtime.gateway";
import { PermissionModule } from "../meetings/permission.module";
import { ChatModule } from "../chat/chat.module";

@Module({
  imports: [PermissionModule, ChatModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
