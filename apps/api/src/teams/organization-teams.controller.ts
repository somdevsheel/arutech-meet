import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createTeamSchema, type CreateTeamDto } from "@arutech/validation";
import { TeamsService } from "./teams.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("teams")
@Controller("organizations/:orgId/teams")
export class OrganizationTeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param("orgId") orgId: string) {
    return this.teams.listForOrg(orgId, user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("orgId") orgId: string,
    @Body(new ZodValidationPipe(createTeamSchema)) dto: CreateTeamDto,
  ) {
    return this.teams.create(orgId, user.id, dto);
  }
}
