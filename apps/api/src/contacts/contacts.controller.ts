import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ContactsService } from "./contacts.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

const callSchema = z.object({ userId: z.string().uuid() });

@ApiTags("contacts")
@Controller("contacts")
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.contactsService.list(user.id);
  }

  @Post("call")
  call(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(callSchema)) dto: z.infer<typeof callSchema>) {
    return this.contactsService.call(user.id, dto.userId);
  }
}
