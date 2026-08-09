import { Module } from "@nestjs/common";
import { PermissionService } from "./permission.service";

/**
 * Split out from MeetingsModule so RealtimeModule (the WebSocket gateway) can depend
 * on PermissionService directly without importing the whole meetings REST module,
 * avoiding a MeetingsModule <-> RealtimeModule circular dependency.
 */
@Module({
  providers: [PermissionService],
  exports: [PermissionService],
})
export class PermissionModule {}
