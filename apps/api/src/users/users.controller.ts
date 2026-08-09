import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { UsersService } from "./users.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional(),
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
    return this.usersService.listSessions(user.id);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.usersService.findPublicProfile(id);
  }
}
