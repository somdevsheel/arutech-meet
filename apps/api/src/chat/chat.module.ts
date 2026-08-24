import { Module } from "@nestjs/common";
import { ChatController, ChatRoomsController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { PermissionModule } from "../meetings/permission.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RealtimeBroadcastModule } from "../realtime/realtime-broadcast.module";
import { AuditLogModule } from "../audit/audit-log.module";
import { ContactsModule } from "../contacts/contacts.module";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [
    PermissionModule,
    NotificationsModule,
    RealtimeBroadcastModule,
    AuditLogModule,
    ContactsModule,
    StorageModule,
  ],
  controllers: [ChatController, ChatRoomsController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
