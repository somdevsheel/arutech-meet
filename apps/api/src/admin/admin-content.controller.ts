import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AdminContentService } from "./admin-content.service";
import { SystemAdminGuard } from "../common/guards/system-admin.guard";

@ApiTags("admin")
@UseGuards(SystemAdminGuard)
@Controller("admin")
export class AdminContentController {
  constructor(private readonly content: AdminContentService) {}

  @Get("organizations")
  listOrganizations(@Query("take") take = "50", @Query("skip") skip = "0") {
    return this.content.listOrganizations(Number(take), Number(skip));
  }

  @Get("meetings")
  listMeetings(
    @Query("take") take = "50",
    @Query("skip") skip = "0",
    @Query("status") status?: string,
  ) {
    return this.content.listMeetings(Number(take), Number(skip), status);
  }

  @Get("classes")
  listClasses(@Query("take") take = "50", @Query("skip") skip = "0") {
    return this.content.listClasses(Number(take), Number(skip));
  }

  @Get("recordings")
  listRecordings(@Query("take") take = "50", @Query("skip") skip = "0") {
    return this.content.listRecordings(Number(take), Number(skip));
  }

  @Get("audit-logs")
  listAuditLogs(@Query("take") take = "50", @Query("skip") skip = "0") {
    return this.content.listAuditLogs(Number(take), Number(skip));
  }
}
