import { Controller, Get, Header, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AttendanceService } from "./attendance.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("classes")
@Controller("class-sessions/:sessionId/attendance")
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post("recompute")
  recompute(@CurrentUser() user: AuthenticatedUser, @Param("sessionId") sessionId: string) {
    return this.attendanceService.recompute(sessionId, user.id);
  }

  @Get()
  get(@CurrentUser() user: AuthenticatedUser, @Param("sessionId") sessionId: string) {
    return this.attendanceService.get(sessionId, user.id);
  }

  @Get("export.csv")
  @Header("Content-Type", "text/csv")
  @Header("Content-Disposition", 'attachment; filename="attendance.csv"')
  exportCsv(@CurrentUser() user: AuthenticatedUser, @Param("sessionId") sessionId: string) {
    return this.attendanceService.exportCsv(sessionId, user.id);
  }
}
