import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  createChatRoomSchema,
  updateChatRoomSchema,
  addChatRoomMemberSchema,
  editMessageSchema,
  forwardMessageSchema,
  presignUploadSchema,
  type CreateChatRoomDto,
  type UpdateChatRoomDto,
  type AddChatRoomMemberDto,
  type EditMessageDto,
  type ForwardMessageDto,
  type PresignUploadDto,
} from "@arutech/validation";
import { ChatService } from "./chat.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("meetings/chat")
@Controller("meetings/:meetingId/chat")
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get("messages")
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.chatService.history(meetingId, user.id, cursor);
  }

  @Delete("messages/:messageId")
  deleteMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("messageId") messageId: string,
  ) {
    return this.chatService.deleteMessage(meetingId, user.id, messageId);
  }

  @Patch("messages/:messageId")
  editMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("messageId") messageId: string,
    @Body(new ZodValidationPipe(editMessageSchema)) dto: EditMessageDto,
  ) {
    return this.chatService.editMessage(meetingId, user.id, messageId, dto);
  }
}

/** "Team Chat" — standing GROUP/DIRECT rooms outside any meeting. Separate
 * top-level path (not nested under a meetingId, unlike ChatController above)
 * since these rooms aren't scoped to one. */
@ApiTags("chat-rooms")
@Controller("chat-rooms")
export class ChatRoomsController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.chatService.listMyRooms(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(createChatRoomSchema)) dto: CreateChatRoomDto) {
    return this.chatService.createRoom(user.id, dto);
  }

  @Get(":id/messages")
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.chatService.roomHistory(id, user.id, cursor);
  }

  @Post(":id/read")
  markRead(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.chatService.markRoomRead(id, user.id);
  }

  @Post(":id/leave")
  leave(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.chatService.leaveRoom(id, user.id);
  }

  @Patch(":id/messages/:messageId")
  editMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("messageId") messageId: string,
    @Body(new ZodValidationPipe(editMessageSchema)) dto: EditMessageDto,
  ) {
    return this.chatService.editRoomMessage(id, user.id, messageId, dto);
  }

  @Delete(":id/messages/:messageId")
  deleteMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("messageId") messageId: string,
  ) {
    return this.chatService.deleteRoomMessage(id, user.id, messageId);
  }

  @Post(":id/messages/forward")
  forwardMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(forwardMessageSchema)) dto: ForwardMessageDto,
  ) {
    return this.chatService.forwardMessage(user.id, id, dto.messageId);
  }

  @Post(":id/files/presign")
  presignAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(presignUploadSchema)) dto: PresignUploadDto,
  ) {
    return this.chatService.presignRoomAttachment(id, user.id, dto);
  }

  @Get(":id/files/:fileId/download")
  downloadAttachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("fileId") fileId: string,
  ) {
    return this.chatService.getRoomAttachmentDownloadUrl(id, user.id, fileId);
  }

  // ── Group management (GROUP rooms only, admin-gated) ──────────────────

  @Patch(":id")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateChatRoomSchema)) dto: UpdateChatRoomDto,
  ) {
    return this.chatService.updateRoom(id, user.id, dto);
  }

  @Post(":id/members")
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addChatRoomMemberSchema)) dto: AddChatRoomMemberDto,
  ) {
    return this.chatService.addMember(id, user.id, dto.userId);
  }

  @Delete(":id/members/:userId")
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ) {
    return this.chatService.removeMember(id, user.id, userId);
  }

  @Post(":id/admins/:userId")
  promoteAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ) {
    return this.chatService.promoteAdmin(id, user.id, userId);
  }

  @Delete(":id/admins/:userId")
  demoteAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ) {
    return this.chatService.demoteAdmin(id, user.id, userId);
  }
}
