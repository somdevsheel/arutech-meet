import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminContentController } from "./admin-content.controller";
import { AdminStatsService } from "./admin-stats.service";
import { AdminUsersService } from "./admin-users.service";
import { AdminContentService } from "./admin-content.service";
import { AuditLogModule } from "../audit/audit-log.module";

@Module({
  imports: [AuditLogModule],
  controllers: [AdminController, AdminContentController],
  providers: [AdminStatsService, AdminUsersService, AdminContentService],
})
export class AdminModule {}
