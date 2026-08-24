import { Module } from "@nestjs/common";
import { CalendarService } from "./calendar.service";
import { CalendarController } from "./calendar.controller";
import { CALENDAR_PROVIDER } from "./providers/calendar-provider.interface";
import { NullCalendarProvider } from "./providers/null-calendar.provider";

/**
 * `CALENDAR_PROVIDER` is a single always-Null binding today — unlike
 * `AiProviderModule`'s factory (which picks between a real and a Null
 * provider based on env vars), there is no real Google/Outlook
 * implementation yet to pick between. See `calendar-provider.interface.ts`.
 * Once one exists, this becomes an `inject: ["ENV"]` factory the same way.
 */
@Module({
  providers: [CalendarService, { provide: CALENDAR_PROVIDER, useClass: NullCalendarProvider }],
  controllers: [CalendarController],
  exports: [CalendarService],
})
export class CalendarModule {}
