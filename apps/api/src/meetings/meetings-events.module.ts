import { Module } from "@nestjs/common";
import { MeetingsEventsService } from "./meetings-events.service";

/** Standalone so LiveKitModule (webhook receiver) can depend on it without importing
 * the whole MeetingsModule, avoiding a LiveKitModule <-> MeetingsModule cycle (Meetings
 * itself depends on LiveKitService to issue room tokens). */
@Module({
  providers: [MeetingsEventsService],
  exports: [MeetingsEventsService],
})
export class MeetingsEventsModule {}
