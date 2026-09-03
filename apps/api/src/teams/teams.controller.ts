import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  addTeamMemberSchema,
  updateTeamSchema,
  updateTeamMemberRoleSchema,
  type AddTeamMemberDto,
  type UpdateTeamDto,
  type UpdateTeamMemberRoleDto,
} from "@arutech/validation";
import { TeamsService } from "./teams.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("teams")
@Controller("teams")
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get(":id")
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.teams.findById(id, user.id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateTeamSchema)) dto: UpdateTeamDto,
  ) {
    return this.teams.update(id, user.id, dto);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.teams.delete(id, user.id);
  }

  @Get(":id/members")
  listMembers(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.teams.listMembers(id, user.id);
  }

  @Post(":id/join")
  join(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.teams.join(id, user.id);
  }

  @Post(":id/members")
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addTeamMemberSchema)) dto: AddTeamMemberDto,
  ) {
    return this.teams.addMember(id, user.id, dto.userId);
  }

  @Post(":id/leave")
  leave(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.teams.leave(id, user.id);
  }

  @Delete(":id/members/:userId")
  removeMember(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("userId") userId: string) {
    return this.teams.removeMember(id, user.id, userId);
  }

  @Patch(":id/members/:userId/role")
  updateMemberRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Body(new ZodValidationPipe(updateTeamMemberRoleSchema)) dto: UpdateTeamMemberRoleDto,
  ) {
    return this.teams.updateMemberRole(id, user.id, userId, dto.role);
  }
}
