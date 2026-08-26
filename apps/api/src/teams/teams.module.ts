import { Module } from "@nestjs/common";
import { TeamsController } from "./teams.controller";
import { OrganizationTeamsController } from "./organization-teams.controller";
import { TeamsService } from "./teams.service";

@Module({
  controllers: [TeamsController, OrganizationTeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
