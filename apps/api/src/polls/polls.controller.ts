import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createPollSchema, respondPollSchema, type CreatePollDto, type RespondPollDto } from "@arutech/validation";
import { PollsService } from "./polls.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("meetings")
@Controller("meetings/:meetingId/polls")
export class PollsController {
  constructor(private readonly pollsService: PollsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string) {
    return this.pollsService.list(meetingId, user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Body(new ZodValidationPipe(createPollSchema)) dto: CreatePollDto,
  ) {
    return this.pollsService.create(meetingId, user.id, dto);
  }

  @Post(":pollId/respond")
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("pollId") pollId: string,
    @Body(new ZodValidationPipe(respondPollSchema)) dto: RespondPollDto,
  ) {
    return this.pollsService.respond(meetingId, user.id, pollId, dto);
  }

  @Post(":pollId/close")
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("pollId") pollId: string,
  ) {
    return this.pollsService.close(meetingId, user.id, pollId);
  }
}
