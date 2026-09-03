import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  createMeetingSchema,
  inviteMeetingParticipantSchema,
  joinMeetingSchema,
  updateMeetingSchema,
  type CreateMeetingDto,
  type InviteMeetingParticipantDto,
  type JoinMeetingDto,
  type UpdateMeetingDto,
} from "@arutech/validation";
import { MeetingsService } from "./meetings.service";
import { PermissionService } from "./permission.service";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("meetings")
@Controller("meetings")
export class MeetingsController {
  constructor(
    private readonly meetingsService: MeetingsService,
    private readonly permissions: PermissionService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  /** What a participant needs to decide whether to show the Whiteboard tab,
   * the Breakout Rooms button, and the Captions control at all — the real
   * enforcement lives server-side in each feature's own service regardless
   * of what this returns; this only avoids showing a control that would
   * just 403 on click. See FeatureFlagsService.listKnownForMeeting. */
  @Get(":id/feature-flags")
  async getFeatureFlags(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    await this.permissions.getParticipant(id, user.id);
    return this.featureFlags.listKnownForMeeting(id);
  }

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

  // Must be registered before the `:code` route below, or Nest/Express would
  // match the literal path segment "personal" as a :code param instead.
  @Get("personal")
  getPersonalRoom(@CurrentUser() user: AuthenticatedUser) {
    return this.meetingsService.getOrCreatePersonalRoom(user.id);
  }

  // Public so an unauthenticated guest can preview a meeting (title/whether a
  // password is required) before deciding to join — no participant data leaks here.
  @Public()
  @Get(":code")
  async findByCode(@Param("code") code: string) {
    const meeting = await this.meetingsService.findByCode(code);
    const org = meeting.organization;
    // Only surface a `branding` object when the org actually set something —
    // an org that never touched its branding fields should render exactly
    // like an unbranded personal meeting, not an empty-but-present object.
    const hasBranding = Boolean(org && (org.logoUrl || org.brandColor || org.joinPageMessage));
    return {
      code: meeting.code,
      title: meeting.title,
      status: meeting.status,
      requiresPassword: Boolean(meeting.passwordHash),
      waitingRoomEnabled: meeting.settings?.waitingRoomEnabled ?? true,
      branding: hasBranding
        ? { orgName: org!.name, logoUrl: org!.logoUrl, brandColor: org!.brandColor, message: org!.joinPageMessage }
        : null,
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

  @Get(":id/invites")
  listInvites(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.meetingsService.listInvites(id, user.id);
  }

  @Post(":id/invites")
  inviteByEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(inviteMeetingParticipantSchema)) dto: InviteMeetingParticipantDto,
  ) {
    return this.meetingsService.inviteByEmail(id, user.id, dto.email, dto.role);
  }

  @Delete(":id/invites/:inviteId")
  revokeInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("inviteId") inviteId: string,
  ) {
    return this.meetingsService.revokeInvite(id, user.id, inviteId);
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
    return this.meetingsService.join(code, { userId: user.id, email: user.email }, dto);
  }

  @Public()
  @Post(":code/join-as-guest")
  joinAsGuest(
    @Param("code") code: string,
    @Body(new ZodValidationPipe(joinMeetingSchema)) dto: JoinMeetingDto,
  ) {
    return this.meetingsService.join(
      code,
      { guestName: dto.guestName, guestParticipantId: dto.guestParticipantId },
      dto,
    );
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
