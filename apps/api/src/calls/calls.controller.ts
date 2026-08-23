import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { initiateCallSchema, type InitiateCallDto } from "@arutech/validation";
import { CallsService } from "./calls.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("calls")
@Controller("calls")
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Post()
  initiate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(initiateCallSchema)) dto: InitiateCallDto,
  ) {
    return this.callsService.initiate(user.id, dto);
  }

  @Get("history")
  history(@CurrentUser() user: AuthenticatedUser) {
    return this.callsService.history(user.id);
  }

  @Post(":callId/accept")
  accept(@CurrentUser() user: AuthenticatedUser, @Param("callId") callId: string) {
    return this.callsService.accept(user.id, callId);
  }

  @Post(":callId/reject")
  reject(@CurrentUser() user: AuthenticatedUser, @Param("callId") callId: string) {
    return this.callsService.reject(user.id, callId);
  }

  @Post(":callId/cancel")
  cancel(@CurrentUser() user: AuthenticatedUser, @Param("callId") callId: string) {
    return this.callsService.cancel(user.id, callId);
  }

  @Post(":callId/end")
  end(@CurrentUser() user: AuthenticatedUser, @Param("callId") callId: string) {
    return this.callsService.end(user.id, callId);
  }
}
