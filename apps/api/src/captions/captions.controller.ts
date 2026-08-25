import { Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CaptionsService } from "./captions.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("meetings/captions")
@Controller("meetings/:meetingId/captions")
export class CaptionsController {
  constructor(private readonly captionsService: CaptionsService) {}

  @Post("start")
  start(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string) {
    return this.captionsService.start(meetingId, user.id);
  }

  @Post("stop")
  stop(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string) {
    return this.captionsService.stop(meetingId, user.id);
  }

  @Get("status")
  status(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string) {
    return this.captionsService.status(meetingId, user.id);
  }
}
