import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { UsersService } from "./users.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  // .nullable() so a client can explicitly clear a previously-set avatar
  // (send `avatarUrl: null`) rather than only ever being able to replace it
  // with another URL — same convention already used for chat rooms' photo
  // (see @arutech/validation's updateChatRoomSchema).
  avatarUrl: z.string().url().nullable().optional(),
  timezone: z.string().max(64).optional(),
  locale: z.string().max(16).optional(),
});

@ApiTags("users")
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findPublicProfile(user.id);
  }

  @Patch("me")
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) dto: z.infer<typeof updateProfileSchema>,
  ) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Get("me/sessions")
  sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.listSessions(user.id, user.sessionId);
  }

  // L-1: Active Sessions was purely read-only — no way to sign out any
  // device but the one you're currently using.
  @Delete("me/sessions/:sessionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeSession(@CurrentUser() user: AuthenticatedUser, @Param("sessionId") sessionId: string) {
    return this.usersService.revokeSession(user.id, sessionId, user.sessionId);
  }

  @Get("by-email/:email")
  findByEmail(@Param("email") email: string) {
    return this.usersService.findByEmail(email);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.usersService.findPublicProfile(id);
  }
}
