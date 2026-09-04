import { Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ParticipantsService } from "./participants.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("meetings/participants")
@Controller("meetings/:meetingId/participants")
export class ParticipantsController {
  constructor(private readonly participantsService: ParticipantsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string) {
    return this.participantsService.list(meetingId, user.id);
  }

  @Get("waiting-room")
  waitingRoom(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string) {
    return this.participantsService.listWaitingRoom(meetingId, user.id);
  }

  @Post(":participantId/admit")
  admit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("participantId") participantId: string,
  ) {
    return this.participantsService.admit(meetingId, user.id, participantId);
  }

  @Post(":participantId/deny")
  deny(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("participantId") participantId: string,
  ) {
    return this.participantsService.deny(meetingId, user.id, participantId);
  }

  @Post(":participantId/mute")
  mute(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("participantId") participantId: string,
  ) {
    return this.participantsService.mute(meetingId, user.id, participantId);
  }

  @Post(":participantId/disable-camera")
  disableCamera(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("participantId") participantId: string,
  ) {
    return this.participantsService.disableCamera(meetingId, user.id, participantId);
  }

  @Post(":participantId/remove")
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("participantId") participantId: string,
  ) {
    return this.participantsService.remove(meetingId, user.id, participantId);
  }

  @Post(":participantId/block")
  block(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("participantId") participantId: string,
  ) {
    return this.participantsService.block(meetingId, user.id, participantId);
  }

  @Post(":participantId/promote-co-host")
  promote(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("participantId") participantId: string,
  ) {
    return this.participantsService.promoteCoHost(meetingId, user.id, participantId);
  }

  @Post(":participantId/screen-share/request")
  requestScreenShare(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("participantId") participantId: string,
  ) {
    return this.participantsService.requestScreenShare(meetingId, user.id, participantId);
  }

  @Post(":participantId/screen-share/approve")
  approveScreenShare(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("participantId") participantId: string,
  ) {
    return this.participantsService.approveScreenShare(meetingId, user.id, participantId);
  }

  @Post(":participantId/screen-share/deny")
  denyScreenShare(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("participantId") participantId: string,
  ) {
    return this.participantsService.denyScreenShare(meetingId, user.id, participantId);
  }
}
