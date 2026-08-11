import { Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RecordingsService } from "./recordings.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("meetings/recordings")
@Controller("meetings/:meetingId/recordings")
export class RecordingsController {
  constructor(private readonly recordingsService: RecordingsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string) {
    return this.recordingsService.list(meetingId, user.id);
  }

  @Post("start")
  start(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string) {
    return this.recordingsService.start(meetingId, user.id);
  }

  @Post(":recordingId/stop")
  stop(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("recordingId") recordingId: string,
  ) {
    return this.recordingsService.stop(meetingId, user.id, recordingId);
  }

  @Get(":recordingId/download")
  getDownloadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("recordingId") recordingId: string,
  ) {
    return this.recordingsService.getDownloadUrl(meetingId, user.id, recordingId);
  }

  @Delete(":recordingId")
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("recordingId") recordingId: string,
  ) {
    return this.recordingsService.remove(meetingId, user.id, recordingId);
  }
}
