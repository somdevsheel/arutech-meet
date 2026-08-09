import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { OrganizationsService } from "./organizations.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

const createOrgSchema = z.object({ name: z.string().min(1).max(100) });
const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

@ApiTags("organizations")
@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOrgSchema)) dto: z.infer<typeof createOrgSchema>,
  ) {
    return this.organizationsService.create(user.id, dto.name);
  }

  @Get()
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.organizationsService.listMine(user.id);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.organizationsService.findById(id, user.id);
  }

  @Post(":id/members")
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addMemberSchema)) dto: z.infer<typeof addMemberSchema>,
  ) {
    return this.organizationsService.addMember(id, user.id, dto.userId, dto.role);
  }
}
