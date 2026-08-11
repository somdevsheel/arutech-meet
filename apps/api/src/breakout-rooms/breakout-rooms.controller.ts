import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  assignBreakoutRoomSchema,
  createBreakoutRoomsSchema,
  type AssignBreakoutRoomDto,
  type CreateBreakoutRoomsDto,
} from "@arutech/validation";
import { BreakoutRoomsService } from "./breakout-rooms.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

const broadcastSchema = z.object({ message: z.string().min(1).max(1000) });

@ApiTags("meetings")
@Controller("meetings/:meetingId/breakout-rooms")
export class BreakoutRoomsController {
  constructor(private readonly breakoutRoomsService: BreakoutRoomsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string) {
    return this.breakoutRoomsService.list(meetingId, user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Body(new ZodValidationPipe(createBreakoutRoomsSchema)) dto: CreateBreakoutRoomsDto,
  ) {
    return this.breakoutRoomsService.create(meetingId, user.id, dto);
  }

  @Post("assign")
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Body(new ZodValidationPipe(assignBreakoutRoomSchema)) dto: AssignBreakoutRoomDto,
  ) {
    return this.breakoutRoomsService.assign(meetingId, user.id, dto);
  }

  @Post(":breakoutRoomId/token")
  issueToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("breakoutRoomId") breakoutRoomId: string,
  ) {
    return this.breakoutRoomsService.issueToken(meetingId, user.id, breakoutRoomId);
  }

  @Post("broadcast")
  broadcast(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Body(new ZodValidationPipe(broadcastSchema)) dto: z.infer<typeof broadcastSchema>,
  ) {
    return this.breakoutRoomsService.broadcastMessage(meetingId, user.id, dto.message);
  }

  @Post("close-all")
  closeAll(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string) {
    return this.breakoutRoomsService.closeAll(meetingId, user.id);
  }
}
