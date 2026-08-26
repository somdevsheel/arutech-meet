import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  answerQuizQuestionSchema,
  createQuizSchema,
  type AnswerQuizQuestionDto,
  type CreateQuizDto,
} from "@arutech/validation";
import { QuizzesService } from "./quizzes.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";

@ApiTags("meetings")
@Controller("meetings/:meetingId/quizzes")
export class QuizzesController {
  constructor(private readonly quizzesService: QuizzesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string) {
    return this.quizzesService.list(meetingId, user.id);
  }

  // Registered ahead of any future "/:quizId"-shaped GET route only matters
  // if one is ever added — "active" would otherwise be swallowed as a
  // literal quiz id. No such route exists today, but keeping this first is
  // the same defensive convention this codebase already uses elsewhere
  // (see OrganizationsController's own comment on the same pattern).
  @Get("active")
  getActive(@CurrentUser() user: AuthenticatedUser, @Param("meetingId") meetingId: string) {
    return this.quizzesService.getActive(meetingId, user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Body(new ZodValidationPipe(createQuizSchema)) dto: CreateQuizDto,
  ) {
    return this.quizzesService.create(meetingId, user.id, dto);
  }

  @Post(":quizId/questions/:questionId/answer")
  answer(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("quizId") quizId: string,
    @Param("questionId") questionId: string,
    @Body(new ZodValidationPipe(answerQuizQuestionSchema)) dto: AnswerQuizQuestionDto,
  ) {
    return this.quizzesService.answer(meetingId, user.id, quizId, questionId, dto);
  }

  @Post(":quizId/close")
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param("meetingId") meetingId: string,
    @Param("quizId") quizId: string,
  ) {
    return this.quizzesService.close(meetingId, user.id, quizId);
  }
}
