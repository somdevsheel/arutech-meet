import { Module } from "@nestjs/common";
import { ChatController, ChatRoomsController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { PermissionModule } from "../meetings/permission.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [PermissionModule, NotificationsModule],
  controllers: [ChatController, ChatRoomsController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
