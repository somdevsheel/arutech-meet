import { Module } from "@nestjs/common";
import { ChatController, ChatRoomsController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { PermissionModule } from "../meetings/permission.module";

@Module({
  imports: [PermissionModule],
  controllers: [ChatController, ChatRoomsController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
