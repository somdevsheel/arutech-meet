import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createChatRoomSchema, type CreateChatRoomDto } from "@arutech/validation";
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
}
