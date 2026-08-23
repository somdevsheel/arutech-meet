import { Module } from "@nestjs/common";
import { TranscriptsController } from "./transcripts.controller";
import { TranscriptsService } from "./transcripts.service";
import { StudyMaterialsController } from "./study-materials.controller";
import { StudyMaterialsService } from "./study-materials.service";
import { AiProviderModule } from "./ai-provider.module";
import { PermissionModule } from "../meetings/permission.module";
import { StorageModule } from "../storage/storage.module";
import { RealtimeBroadcastModule } from "../realtime/realtime-broadcast.module";
import { AuditLogModule } from "../audit/audit-log.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ClassesModule } from "../classes/classes.module";

@Module({
  imports: [
    AiProviderModule,
    PermissionModule,
    StorageModule,
    RealtimeBroadcastModule,
    AuditLogModule,
    NotificationsModule,
    ClassesModule,
  ],
  controllers: [TranscriptsController, StudyMaterialsController],
  providers: [TranscriptsService, StudyMaterialsService],
  exports: [TranscriptsService, StudyMaterialsService],
})
export class AiModule {}
