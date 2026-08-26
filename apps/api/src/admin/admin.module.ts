import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminContentController } from "./admin-content.controller";
import { AdminFeatureFlagsController } from "./admin-feature-flags.controller";
import { AdminReportsController } from "./admin-reports.controller";
import { AdminStatsService } from "./admin-stats.service";
import { AdminUsersService } from "./admin-users.service";
import { AdminContentService } from "./admin-content.service";
import { AdminAnalyticsService } from "./admin-analytics.service";
import { AuditLogModule } from "../audit/audit-log.module";
import { FeatureFlagsModule } from "../feature-flags/feature-flags.module";
import { ReportsModule } from "../reports/reports.module";

@Module({
  imports: [AuditLogModule, FeatureFlagsModule, ReportsModule],
  controllers: [AdminController, AdminContentController, AdminFeatureFlagsController, AdminReportsController],
  providers: [AdminStatsService, AdminUsersService, AdminContentService, AdminAnalyticsService],
})
export class AdminModule {}
