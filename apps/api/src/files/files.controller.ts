import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { presignUploadSchema, type PresignUploadDto } from "@arutech/validation";
import { FilesService } from "./files.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("meetings/files")
@Controller("meetings/:meetingId/files")
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post("presign")
  presign(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Body(new ZodValidationPipe(presignUploadSchema)) dto: PresignUploadDto,
  ) {
    return this.filesService.presignMeetingUpload(meetingId, user.id, dto);
  }

  @Get(":fileId/download")
  download(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("fileId") fileId: string,
  ) {
    return this.filesService.getDownloadUrl(meetingId, user.id, fileId);
  }
}
