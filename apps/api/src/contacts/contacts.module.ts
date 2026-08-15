import { Module } from "@nestjs/common";
import { ContactsController } from "./contacts.controller";
import { ContactsService } from "./contacts.service";
import { MeetingsModule } from "../meetings/meetings.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [MeetingsModule, NotificationsModule],
  controllers: [ContactsController],
  providers: [ContactsService],
})
export class ContactsModule {}
