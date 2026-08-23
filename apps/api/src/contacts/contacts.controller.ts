import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  blockUserSchema,
  createContactGroupSchema,
  addToContactGroupSchema,
  type BlockUserDto,
  type CreateContactGroupDto,
  type AddToContactGroupDto,
} from "@arutech/validation";
import { ContactsService } from "./contacts.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("contacts")
@Controller("contacts")
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.contactsService.list(user.id);
  }

  // "Call" moved to POST /calls (see apps/api/src/calls) — a real
  // ring/accept/decline flow on the Call/CallParticipant schema, replacing
  // the instant-meeting-plus-notification stand-in that used to live here.

  @Get("blocked")
  listBlocked(@CurrentUser() user: AuthenticatedUser) {
    return this.contactsService.listBlocked(user.id);
  }

  @Post("blocked")
  block(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(blockUserSchema)) dto: BlockUserDto) {
    return this.contactsService.block(user.id, dto.userId);
  }

  @Delete("blocked/:userId")
  unblock(@CurrentUser() user: AuthenticatedUser, @Param("userId") userId: string) {
    return this.contactsService.unblock(user.id, userId);
  }

  @Post(":userId/favorite")
  favorite(@CurrentUser() user: AuthenticatedUser, @Param("userId") userId: string) {
    return this.contactsService.favorite(user.id, userId);
  }

  @Delete(":userId/favorite")
  unfavorite(@CurrentUser() user: AuthenticatedUser, @Param("userId") userId: string) {
    return this.contactsService.unfavorite(user.id, userId);
  }

  @Get("groups")
  listGroups(@CurrentUser() user: AuthenticatedUser) {
    return this.contactsService.listGroups(user.id);
  }

  @Post("groups")
  createGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createContactGroupSchema)) dto: CreateContactGroupDto,
  ) {
    return this.contactsService.createGroup(user.id, dto.name);
  }

  @Delete("groups/:groupId")
  deleteGroup(@CurrentUser() user: AuthenticatedUser, @Param("groupId") groupId: string) {
    return this.contactsService.deleteGroup(user.id, groupId);
  }

  @Post("groups/:groupId/members")
  addToGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param("groupId") groupId: string,
    @Body(new ZodValidationPipe(addToContactGroupSchema)) dto: AddToContactGroupDto,
  ) {
    return this.contactsService.addToGroup(user.id, groupId, dto.userId);
  }

  @Delete("groups/:groupId/members/:userId")
  removeFromGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param("groupId") groupId: string,
    @Param("userId") userId: string,
  ) {
    return this.contactsService.removeFromGroup(user.id, groupId, userId);
  }
}
