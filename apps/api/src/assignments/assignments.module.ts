import { Module } from "@nestjs/common";
import { AssignmentsController } from "./assignments.controller";
import { AssignmentsService } from "./assignments.service";
import { StorageModule } from "../storage/storage.module";
import { ClassesModule } from "../classes/classes.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [StorageModule, ClassesModule, NotificationsModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}
