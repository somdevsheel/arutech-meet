import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  addTeacherSchema,
  createClassSchema,
  createClassSessionSchema,
  enrollStudentSchema,
  updateClassSchema,
  type AddTeacherDto,
  type CreateClassDto,
  type CreateClassSessionDto,
  type EnrollStudentDto,
  type UpdateClassDto,
} from "@arutech/validation";
import { ClassesService } from "./classes.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("classes")
@Controller("classes")
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createClassSchema)) dto: CreateClassDto,
  ) {
    return this.classesService.create(user.id, dto);
  }

  @Get()
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.classesService.listMine(user.id);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.classesService.findById(id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateClassSchema)) dto: UpdateClassDto,
  ) {
    return this.classesService.update(id, user.id, dto);
  }

  @Post(":id/teachers")
  addTeacher(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addTeacherSchema)) dto: AddTeacherDto,
  ) {
    return this.classesService.addTeacher(id, user.id, dto);
  }

  @Post(":id/students")
  enrollStudent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(enrollStudentSchema)) dto: EnrollStudentDto,
  ) {
    return this.classesService.enrollStudent(id, user.id, dto);
  }

  @Delete(":id/students/:studentUserId")
  removeStudent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("studentUserId") studentUserId: string,
  ) {
    return this.classesService.removeStudent(id, user.id, studentUserId);
  }

  @Post(":id/sessions")
  createSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createClassSessionSchema)) dto: CreateClassSessionDto,
  ) {
    return this.classesService.createSession(id, user.id, dto);
  }

  @Get(":id/sessions")
  listSessions(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.classesService.listSessions(id, user.id);
  }
}
