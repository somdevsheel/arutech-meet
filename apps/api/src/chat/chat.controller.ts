import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ChatService } from "./chat.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
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
