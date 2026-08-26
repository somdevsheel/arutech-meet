import { Module } from "@nestjs/common";
import { ReportsService } from "./reports.service";
import { ReportsController } from "./reports.controller";
import { PermissionModule } from "../meetings/permission.module";
import { AuditLogModule } from "../audit/audit-log.module";

@Module({
  imports: [PermissionModule, AuditLogModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
