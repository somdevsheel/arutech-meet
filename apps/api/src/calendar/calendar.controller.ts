import { BadRequestException, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../common/types/authenticated-user";
import { CalendarService } from "./calendar.service";
import { CALENDAR_PROVIDER, type CalendarProvider, type CalendarProviderName } from "./providers/calendar-provider.interface";

@ApiTags("calendar")
@Controller("calendar")
export class CalendarController {
  constructor(
    private readonly calendar: CalendarService,
    @Inject(CALENDAR_PROVIDER) private readonly provider: CalendarProvider,
  ) {}

  @Get("events")
  listEvents(@CurrentUser() user: AuthenticatedUser, @Query("from") from?: string, @Query("to") to?: string) {
    if (!from || !to) {
      throw new BadRequestException("from and to query params are required (ISO date strings)");
    }
    return this.calendar.listEvents(user.id, new Date(from), new Date(to));
  }

  // Real endpoint, honestly unconfigured — see NullCalendarProvider. Not a
  // dead button: it round-trips to the server and surfaces a real 503.
  @Post("connect/:provider")
  connect(@CurrentUser() user: AuthenticatedUser, @Param("provider") provider: string) {
    if (provider !== "google" && provider !== "outlook") {
      throw new BadRequestException("Unknown calendar provider — expected google or outlook");
    }
    return this.provider.connect(user.id, provider as CalendarProviderName);
  }
}
