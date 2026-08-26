import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { resolveReportSchema, type ResolveReportDto } from "@arutech/validation";
import { ReportsService } from "../reports/reports.service";
import { SystemAdminGuard } from "../common/guards/system-admin.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("admin")
@UseGuards(SystemAdminGuard)
@Controller("admin/reports")
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(
    @Query("status") status?: "OPEN" | "RESOLVED" | "DISMISSED",
    @Query("take") take = "50",
    @Query("skip") skip = "0",
  ) {
    return this.reports.listForAdmin(status, Number(take), Number(skip));
  }

  @Patch(":id")
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(resolveReportSchema)) dto: ResolveReportDto,
  ) {
    return this.reports.resolve(id, user.id, dto);
  }
}
