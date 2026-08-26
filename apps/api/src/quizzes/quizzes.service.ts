import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { WS_EVENTS } from "@arutech/types";
import type { AnswerQuizQuestionDto, CreateQuizDto } from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";
import { PermissionService } from "../meetings/permission.service";
import { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";

@Injectable()
export class QuizzesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly broadcast: RealtimeBroadcastService,
  ) {}

  async create(meetingId: string, callerUserId: string, dto: CreateQuizDto) {
    await this.permissions.requireCapability(meetingId, callerUserId, "quiz.create");

    const quiz = await this.prisma.client.quiz.create({
      data: {
        meetingId,
        createdByUserId: callerUserId,
        title: dto.title,
        status: "OPEN",
        questions: {
          create: dto.questions.map((q, order) => ({
            type: q.type,
            question: q.question,
            order,
            points: q.points,
            timerSeconds: q.timerSeconds,
            // TRUE_FALSE has no client-authored options — server-generates the
            // two fixed ones so it rides the exact same option/answer/grading
            // pipeline MULTIPLE_CHOICE already uses (see the schema comment on
            // QuizQuestionType).
            options:
              q.type === "MULTIPLE_CHOICE"
                ? { create: q.options.map((o, oi) => ({ text: o.text, isCorrect: o.isCorrect, order: oi })) }
                : q.type === "TRUE_FALSE"
                  ? {
                      create: [
                        { text: "True", isCorrect: q.correctAnswer === true, order: 0 },
                        { text: "False", isCorrect: q.correctAnswer === false, order: 1 },
                      ],
                    }
                  : undefined,
            correctAnswerText: q.type === "SHORT_ANSWER" ? q.correctAnswerText : undefined,
          })),
        },
      },
      include: { questions: { include: { options: true }, orderBy: { order: "asc" } } },
    });

    // Never send `isCorrect`/`correctAnswerText` to clients before a question
    // is answered/closed — students would otherwise see the answer key in the
    // network tab.
    await this.broadcast.publish(meetingId, WS_EVENTS.QUIZ_PUBLISHED, {
      id: quiz.id,
      title: quiz.title,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        type: q.type,
        question: q.question,
        points: q.points,
        timerSeconds: q.timerSeconds,
        options: q.options.map((o) => ({ id: o.id, text: o.text })),
      })),
    });
    return quiz;
  }

  /** The real catch-up path a participant's client needs on mount — without
   * this, only whoever already had the Quiz tab open at the exact moment
   * QUIZ_PUBLISHED fired ever sees the active question at all (a genuine,
   * previously-uncaught gap: `list()` above exists but is a lightweight
   * summary — no `options`, no `status` — meant for history views, not for
   * resuming an in-progress quiz). Same sanitized shape `create`'s own
   * QUIZ_PUBLISHED broadcast already uses (`isCorrect`/`correctAnswerText`
   * stripped) so the client's existing `onPublished` handler can consume
   * either one identically. Returns `null` when nothing is currently OPEN —
   * a real, meaningful state, not an error. */
  async getActive(meetingId: string, callerUserId: string) {
    await this.permissions.getParticipant(meetingId, callerUserId);
    const quiz = await this.prisma.client.quiz.findFirst({
      where: { meetingId, status: "OPEN" },
      include: { questions: { include: { options: true }, orderBy: { order: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    if (!quiz) return null;
    return {
      id: quiz.id,
      title: quiz.title,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        type: q.type,
        question: q.question,
        points: q.points,
        timerSeconds: q.timerSeconds,
        options: q.options.map((o) => ({ id: o.id, text: o.text })),
      })),
    };
  }

  async answer(
    meetingId: string,
    callerUserId: string,
    quizId: string,
    questionId: string,
    dto: AnswerQuizQuestionDto,
  ) {
    await this.permissions.requireCapability(meetingId, callerUserId, "quiz.answer");
    const question = await this.prisma.client.quizQuestion.findUnique({
      where: { id: questionId },
      include: { options: true, quiz: true },
    });
    if (!question || question.quizId !== quizId || question.quiz.meetingId !== meetingId) {
      throw new NotFoundException("Question not found");
    }
    if (question.quiz.status !== "OPEN") throw new BadRequestException("This quiz is closed");

    let selectedOptionId: string | null = null;
    let answerText: string | null = null;
    let isCorrect: boolean;

    if (question.type === "SHORT_ANSWER") {
      if (!dto.answerText) throw new BadRequestException("This question expects a text answer");
      answerText = dto.answerText.trim();
      // Case-insensitive, trimmed exact match only — no fuzzy/synonym
      // matching (see the schema comment on QuizQuestion.correctAnswerText).
      isCorrect = answerText.toLowerCase() === (question.correctAnswerText ?? "").trim().toLowerCase();
    } else {
      if (!dto.selectedOptionId) throw new BadRequestException("This question expects a selected option");
      const option = question.options.find((o) => o.id === dto.selectedOptionId);
      if (!option) throw new BadRequestException("Invalid option for this question");
      selectedOptionId = option.id;
      isCorrect = option.isCorrect;
    }

    const answer = await this.prisma.client.quizAnswer.upsert({
      where: { questionId_userId: { questionId, userId: callerUserId } },
      create: {
        questionId,
        userId: callerUserId,
        selectedOptionId,
        answerText,
        isCorrect,
        pointsAwarded: isCorrect ? question.points : 0,
      },
      update: {
        selectedOptionId,
        answerText,
        isCorrect,
        pointsAwarded: isCorrect ? question.points : 0,
      },
    });

    await this.broadcast.publish(meetingId, WS_EVENTS.QUIZ_ANSWER, {
      quizId,
      questionId,
      answeredCount: await this.prisma.client.quizAnswer.count({ where: { questionId } }),
    });

    // Only the answering student learns whether they were right — correctness for
    // everyone else stays server-side until the quiz is closed.
    return { isCorrect: answer.isCorrect, pointsAwarded: answer.pointsAwarded };
  }

  async close(meetingId: string, callerUserId: string, quizId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "quiz.create");
    const quiz = await this.prisma.client.quiz.findUnique({
      where: { id: quizId },
      include: { questions: { include: { options: true, answers: true } } },
    });
    if (!quiz || quiz.meetingId !== meetingId) throw new NotFoundException("Quiz not found");

    await this.prisma.client.quiz.update({
      where: { id: quizId },
      data: { status: "CLOSED", closedAt: new Date() },
    });

    const scoresByUser = new Map<string, number>();
    for (const question of quiz.questions) {
      for (const answer of question.answers) {
        scoresByUser.set(answer.userId, (scoresByUser.get(answer.userId) ?? 0) + answer.pointsAwarded);
      }
    }
    const leaderboard = await this.buildLeaderboard(scoresByUser);

    const results = quiz.questions.map((q) => ({
      questionId: q.id,
      question: q.question,
      type: q.type,
      correctOptionId: q.options.find((o) => o.isCorrect)?.id ?? null,
      options: q.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })),
      correctAnswerText: q.type === "SHORT_ANSWER" ? q.correctAnswerText : null,
    }));

    await this.broadcast.publish(meetingId, WS_EVENTS.QUIZ_CLOSED, { quizId, results, leaderboard });
    return { results, leaderboard };
  }

  async list(meetingId: string, callerUserId: string) {
    await this.permissions.getParticipant(meetingId, callerUserId);
    return this.prisma.client.quiz.findMany({
      where: { meetingId },
      include: { questions: { select: { id: true, type: true, question: true, points: true, order: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  private async buildLeaderboard(scoresByUser: Map<string, number>) {
    const userIds = [...scoresByUser.keys()];
    if (userIds.length === 0) return [];
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, displayName: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.displayName]));
    return [...scoresByUser.entries()]
      .map(([userId, score]) => ({ userId, displayName: nameById.get(userId) ?? "Unknown", score }))
      .sort((a, b) => b.score - a.score);
  }
}
