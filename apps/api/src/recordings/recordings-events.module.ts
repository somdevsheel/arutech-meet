import { Module } from "@nestjs/common";
import { RecordingsEventsService } from "./recordings-events.service";

@Module({
  providers: [RecordingsEventsService],
  exports: [RecordingsEventsService],
})
export class RecordingsEventsModule {}
