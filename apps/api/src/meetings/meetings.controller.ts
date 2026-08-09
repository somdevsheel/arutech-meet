import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  createMeetingSchema,
  joinMeetingSchema,
  updateMeetingSchema,
  type CreateMeetingDto,
  type JoinMeetingDto,
  type UpdateMeetingDto,
} from "@arutech/validation";
import { MeetingsService } from "./meetings.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("meetings")
@Controller("meetings")
export class MeetingsController {
  constructor(private readonly meetingsService: MeetingsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createMeetingSchema)) dto: CreateMeetingDto,
  ) {
    return this.meetingsService.create(user.id, dto);
  }

  @Get()
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.meetingsService.listMine(user.id);
  }

  // Public so an unauthenticated guest can preview a meeting (title/whether a
  // password is required) before deciding to join — no participant data leaks here.
  @Public()
  @Get(":code")
  async findByCode(@Param("code") code: string) {
    const meeting = await this.meetingsService.findByCode(code);
    return {
      code: meeting.code,
      title: meeting.title,
      status: meeting.status,
      requiresPassword: Boolean(meeting.passwordHash),
      waitingRoomEnabled: meeting.settings?.waitingRoomEnabled ?? true,
    };
  }

  @Patch(":id/settings")
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateMeetingSchema)) dto: UpdateMeetingDto,
  ) {
    return this.meetingsService.updateSettings(id, user.id, dto);
  }

  @Post(":id/end")
  end(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.meetingsService.end(id, user.id);
  }

  // Authenticated join. Guests use POST /meetings/:code/join-as-guest (below) instead,
  // since they have no access token — the two are intentionally separate endpoints
  // rather than one branching on optional auth, so guest access is an explicit choice.
  @Post(":code/join")
  join(
    @CurrentUser() user: AuthenticatedUser,
    @Param("code") code: string,
    @Body(new ZodValidationPipe(joinMeetingSchema)) dto: JoinMeetingDto,
  ) {
    return this.meetingsService.join(code, { userId: user.id }, dto);
  }

  @Public()
  @Post(":code/join-as-guest")
  joinAsGuest(
    @Param("code") code: string,
    @Body(new ZodValidationPipe(joinMeetingSchema)) dto: JoinMeetingDto,
  ) {
    return this.meetingsService.join(code, { guestName: dto.guestName }, dto);
  }

  @Post(":id/participants/:participantId/token")
  reissueToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("participantId") participantId: string,
  ) {
    return this.meetingsService.issueTokenForCaller(id, participantId, user.id);
  }
}
