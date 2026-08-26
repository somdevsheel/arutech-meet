import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  addOrgMemberSchema,
  createOrganizationSchema,
  inviteOrgMemberSchema,
  updateOrgBrandingSchema,
  updateOrgMemberRoleSchema,
  type AddOrgMemberDto,
  type CreateOrganizationDto,
  type InviteOrgMemberDto,
  type UpdateOrgBrandingDto,
  type UpdateOrgMemberRoleDto,
} from "@arutech/validation";
import { OrganizationsService } from "./organizations.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("organizations")
@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOrganizationSchema)) dto: CreateOrganizationDto,
  ) {
    return this.organizationsService.create(user.id, dto.name);
  }

  @Get()
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.organizationsService.listMine(user.id);
  }

  // Registered ahead of ":id" only matters if a literal segment could
  // collide with a real org id (uuid) — it never will, but kept in the
  // conventional "specific literal routes before :id" order regardless.
  @Public()
  @Get("invites/:token/preview")
  previewInvite(@Param("token") token: string) {
    return this.organizationsService.previewInvite(token);
  }

  @Post("invites/:token/accept")
  acceptInvite(@CurrentUser() user: AuthenticatedUser, @Param("token") token: string) {
    return this.organizationsService.acceptInvite(token, user.id);
  }

  @Get(":id")
  findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.organizationsService.findById(id, user.id);
  }

  @Get(":id/members")
  listMembers(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.organizationsService.listMembers(id, user.id);
  }

  @Post(":id/members")
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addOrgMemberSchema)) dto: AddOrgMemberDto,
  ) {
    return this.organizationsService.addMember(id, user.id, dto.userId, dto.role);
  }

  @Delete(":id/members/:userId")
  removeMember(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("userId") userId: string) {
    return this.organizationsService.removeMember(id, user.id, userId);
  }

  @Post(":id/leave")
  leave(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.organizationsService.leaveOrg(id, user.id);
  }

  @Patch(":id/members/:userId/role")
  updateMemberRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Body(new ZodValidationPipe(updateOrgMemberRoleSchema)) dto: UpdateOrgMemberRoleDto,
  ) {
    return this.organizationsService.updateMemberRole(id, user.id, userId, dto.role);
  }

  @Patch(":id/branding")
  updateBranding(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateOrgBrandingSchema)) dto: UpdateOrgBrandingDto,
  ) {
    return this.organizationsService.updateBranding(id, user.id, dto);
  }

  @Get(":id/invites")
  listInvites(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.organizationsService.listInvites(id, user.id);
  }

  @Post(":id/invites")
  inviteByEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(inviteOrgMemberSchema)) dto: InviteOrgMemberDto,
  ) {
    return this.organizationsService.inviteByEmail(id, user.id, dto.email, dto.role);
  }

  @Delete(":id/invites/:inviteId")
  revokeInvite(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("inviteId") inviteId: string) {
    return this.organizationsService.revokeInvite(id, user.id, inviteId);
  }
}
