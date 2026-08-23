import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  createAssignmentSchema,
  updateAssignmentSchema,
  submitAssignmentSchema,
  gradeSubmissionSchema,
  presignUploadSchema,
  type CreateAssignmentDto,
  type UpdateAssignmentDto,
  type SubmitAssignmentDto,
  type GradeSubmissionDto,
  type PresignUploadDto,
} from "@arutech/validation";
import { AssignmentsService } from "./assignments.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("classes/assignments")
@Controller("classes/:classId/assignments")
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("classId") classId: string,
    @Body(new ZodValidationPipe(createAssignmentSchema)) dto: CreateAssignmentDto,
  ) {
    return this.assignments.create(classId, user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param("classId") classId: string) {
    return this.assignments.list(classId, user.id);
  }

  @Post("presign")
  presign(
    @CurrentUser() user: AuthenticatedUser,
    @Param("classId") classId: string,
    @Body(new ZodValidationPipe(presignUploadSchema)) dto: PresignUploadDto,
  ) {
    return this.assignments.presignAttachment(classId, user.id, dto);
  }

  @Get(":assignmentId")
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param("classId") classId: string,
    @Param("assignmentId") assignmentId: string,
  ) {
    return this.assignments.getOne(classId, assignmentId, user.id);
  }

  @Patch(":assignmentId")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("classId") classId: string,
    @Param("assignmentId") assignmentId: string,
    @Body(new ZodValidationPipe(updateAssignmentSchema)) dto: UpdateAssignmentDto,
  ) {
    return this.assignments.update(classId, assignmentId, user.id, dto);
  }

  @Delete(":assignmentId")
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("classId") classId: string,
    @Param("assignmentId") assignmentId: string,
  ) {
    return this.assignments.remove(classId, assignmentId, user.id);
  }

  @Get(":assignmentId/files/:fileId/download")
  download(
    @CurrentUser() user: AuthenticatedUser,
    @Param("classId") classId: string,
    @Param("assignmentId") assignmentId: string,
    @Param("fileId") fileId: string,
  ) {
    return this.assignments.getAttachmentDownloadUrl(classId, assignmentId, user.id, fileId);
  }

  @Post(":assignmentId/submissions")
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("classId") classId: string,
    @Param("assignmentId") assignmentId: string,
    @Body(new ZodValidationPipe(submitAssignmentSchema)) dto: SubmitAssignmentDto,
  ) {
    return this.assignments.submit(classId, assignmentId, user.id, dto);
  }

  @Get(":assignmentId/submissions")
  listSubmissions(
    @CurrentUser() user: AuthenticatedUser,
    @Param("classId") classId: string,
    @Param("assignmentId") assignmentId: string,
  ) {
    return this.assignments.listSubmissions(classId, assignmentId, user.id);
  }

  @Get(":assignmentId/submissions/me")
  getMySubmission(
    @CurrentUser() user: AuthenticatedUser,
    @Param("classId") classId: string,
    @Param("assignmentId") assignmentId: string,
  ) {
    return this.assignments.getMySubmission(classId, assignmentId, user.id);
  }

  @Post(":assignmentId/submissions/:studentId/grade")
  grade(
    @CurrentUser() user: AuthenticatedUser,
    @Param("classId") classId: string,
    @Param("assignmentId") assignmentId: string,
    @Param("studentId") studentId: string,
    @Body(new ZodValidationPipe(gradeSubmissionSchema)) dto: GradeSubmissionDto,
  ) {
    return this.assignments.grade(classId, assignmentId, studentId, user.id, dto);
  }
}
