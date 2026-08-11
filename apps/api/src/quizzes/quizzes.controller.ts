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
