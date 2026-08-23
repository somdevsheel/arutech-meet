import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { generateTranscriptSchema, type GenerateTranscriptDto } from "@arutech/validation";
import { TranscriptsService } from "./transcripts.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("meetings/transcripts")
@Controller("meetings/:meetingId/transcripts")
export class TranscriptsController {
  constructor(private readonly transcripts: TranscriptsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string) {
    return this.transcripts.list(meetingId, user.id);
  }

  @Post()
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Body(new ZodValidationPipe(generateTranscriptSchema)) dto: GenerateTranscriptDto,
  ) {
    return this.transcripts.generate(meetingId, user.id, dto.recordingId);
  }

  // Declared before the ":transcriptId" route below so NestJS matches the
  // literal "search" segment first — see TranscriptsService.search.
  @Get("search")
  search(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string, @Query("q") q = "") {
    return this.transcripts.search(meetingId, user.id, q);
  }

  @Get(":transcriptId")
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("transcriptId") transcriptId: string,
  ) {
    return this.transcripts.get(meetingId, user.id, transcriptId);
  }

  @Delete(":transcriptId")
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("transcriptId") transcriptId: string,
  ) {
    return this.transcripts.remove(meetingId, user.id, transcriptId);
  }
}
