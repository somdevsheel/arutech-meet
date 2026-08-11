import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { saveWhiteboardPageSchema, type SaveWhiteboardPageDto } from "@arutech/validation";
import { WhiteboardService } from "./whiteboard.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("meetings")
@Controller("meetings/:meetingId/whiteboard")
export class WhiteboardController {
  constructor(private readonly whiteboardService: WhiteboardService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string) {
    return this.whiteboardService.getOrCreate(meetingId, user.id);
  }

  @Post("pages")
  addPage(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string) {
    return this.whiteboardService.addPage(meetingId, user.id);
  }

  @Post("pages/save")
  savePage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Body(new ZodValidationPipe(saveWhiteboardPageSchema)) dto: SaveWhiteboardPageDto,
  ) {
    return this.whiteboardService.savePage(meetingId, user.id, dto);
  }
}
