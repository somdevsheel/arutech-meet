import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AdminStatsService } from "./admin-stats.service";
import { AdminUsersService } from "./admin-users.service";
import { AdminAnalyticsService } from "./admin-analytics.service";
import { SystemAdminGuard } from "../common/guards/system-admin.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("admin")
@UseGuards(SystemAdminGuard)
@Controller("admin")
export class AdminController {
  constructor(
    private readonly stats: AdminStatsService,
    private readonly users: AdminUsersService,
    private readonly analytics: AdminAnalyticsService,
  ) {}

  @Get("stats")
  getStats() {
    return this.stats.getDashboardStats();
  }

  @Get("system-health")
  getSystemHealth() {
    return this.stats.getSystemHealth();
  }

  @Get("analytics")
  getAnalytics(@Query("days") days = "30") {
    return this.analytics.getFeatureEngagement(Number(days));
  }

  @Get("users")
  listUsers(@Query("search") search?: string, @Query("take") take = "50", @Query("skip") skip = "0") {
    return this.users.list(search, Number(take), Number(skip));
  }

  @Post("users/:id/suspend")
  suspendUser(@CurrentUser() admin: AuthenticatedUser, @Param("id") id: string) {
    return this.users.suspend(admin.id, id);
  }

  @Post("users/:id/activate")
  activateUser(@CurrentUser() admin: AuthenticatedUser, @Param("id") id: string) {
    return this.users.activate(admin.id, id);
  }
}
