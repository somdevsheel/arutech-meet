import { Module } from "@nestjs/common";
import { RecordingsController, MyRecordingsController } from "./recordings.controller";
import { RecordingsService } from "./recordings.service";
import { RecordingsCleanupService } from "./recordings-cleanup.service";
import { PermissionModule } from "../meetings/permission.module";
import { LiveKitModule } from "../livekit/livekit.module";
import { StorageModule } from "../storage/storage.module";
import { RealtimeBroadcastModule } from "../realtime/realtime-broadcast.module";
import { AuditLogModule } from "../audit/audit-log.module";

@Module({
  imports: [PermissionModule, LiveKitModule, StorageModule, RealtimeBroadcastModule, AuditLogModule],
  controllers: [RecordingsController, MyRecordingsController],
  providers: [RecordingsService, RecordingsCleanupService],
  exports: [RecordingsService],
})
export class RecordingsModule {}
