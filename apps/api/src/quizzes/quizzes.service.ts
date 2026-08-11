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
            question: q.question,
            order,
            points: q.points,
            timerSeconds: q.timerSeconds,
            options: { create: q.options.map((o, oi) => ({ text: o.text, isCorrect: o.isCorrect, order: oi })) },
          })),
        },
      },
      include: { questions: { include: { options: true }, orderBy: { order: "asc" } } },
    });

    // Never send `isCorrect` to clients before a question is answered/closed —
    // students would otherwise see the answer key in the network tab.
    await this.broadcast.publish(meetingId, WS_EVENTS.QUIZ_PUBLISHED, {
      id: quiz.id,
      title: quiz.title,
      questions: quiz.questions.map((q) => ({
        id: q.id,
        question: q.question,
        points: q.points,
        timerSeconds: q.timerSeconds,
        options: q.options.map((o) => ({ id: o.id, text: o.text })),
      })),
    });
    return quiz;
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

    const option = question.options.find((o) => o.id === dto.selectedOptionId);
    if (!option) throw new BadRequestException("Invalid option for this question");

    const answer = await this.prisma.client.quizAnswer.upsert({
      where: { questionId_userId: { questionId, userId: callerUserId } },
      create: {
        questionId,
        userId: callerUserId,
        selectedOptionId: option.id,
        isCorrect: option.isCorrect,
        pointsAwarded: option.isCorrect ? question.points : 0,
      },
      update: {
        selectedOptionId: option.id,
        isCorrect: option.isCorrect,
        pointsAwarded: option.isCorrect ? question.points : 0,
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
      correctOptionId: q.options.find((o) => o.isCorrect)?.id ?? null,
      options: q.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })),
    }));

    await this.broadcast.publish(meetingId, WS_EVENTS.QUIZ_CLOSED, { quizId, results, leaderboard });
    return { results, leaderboard };
  }

  async list(meetingId: string, callerUserId: string) {
    await this.permissions.getParticipant(meetingId, callerUserId);
    return this.prisma.client.quiz.findMany({
      where: { meetingId },
      include: { questions: { select: { id: true, question: true, points: true, order: true } } },
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
