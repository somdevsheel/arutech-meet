import { BadRequestException } from "@nestjs/common";
import { QuizzesService } from "./quizzes.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { PermissionService } from "../meetings/permission.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";

function makeDeps(overrides?: { question?: unknown }) {
  const prisma = {
    client: {
      quiz: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "quiz-1",
            meetingId: data.meetingId,
            title: data.title,
            questions: data.questions.create.map((q: Record<string, unknown>, i: number) => ({
              id: `q-${i}`,
              ...q,
              options: (q.options as { create?: Record<string, unknown>[] } | undefined)?.create?.map(
                (o, oi: number) => ({ id: `opt-${i}-${oi}`, ...o }),
              ) ?? [],
            })),
          }),
        ),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
      },
      quizQuestion: {
        findUnique: jest.fn().mockResolvedValue(overrides?.question ?? null),
      },
      quizAnswer: {
        upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: "answer-1", ...create })),
        count: jest.fn().mockResolvedValue(1),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    },
  } as unknown as PrismaService;

  const permissions = {
    requireCapability: jest.fn().mockResolvedValue({ role: "TEACHER" }),
    requireOwnerOrCapability: jest.fn().mockResolvedValue(undefined),
    getParticipant: jest.fn().mockResolvedValue({}),
  } as unknown as PermissionService;

  const broadcast = { publish: jest.fn() } as unknown as RealtimeBroadcastService;

  return { prisma, permissions, broadcast };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new QuizzesService(deps.prisma, deps.permissions, deps.broadcast);
}

describe("QuizzesService.create", () => {
  it("server-generates True/False options for a TRUE_FALSE question, matching the given correct answer", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.create("meeting-1", "teacher-1", {
      title: "Quick check",
      questions: [{ type: "TRUE_FALSE", question: "The sky is blue", points: 1, correctAnswer: true }],
    });

    expect(deps.prisma.client.quiz.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          questions: {
            create: [
              expect.objectContaining({
                type: "TRUE_FALSE",
                options: {
                  create: [
                    { text: "True", isCorrect: true, order: 0 },
                    { text: "False", isCorrect: false, order: 1 },
                  ],
                },
              }),
            ],
          },
        }),
      }),
    );
  });

  it("stores correctAnswerText for a SHORT_ANSWER question and creates no options", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.create("meeting-1", "teacher-1", {
      title: "Quick check",
      questions: [{ type: "SHORT_ANSWER", question: "Capital of France?", points: 2, correctAnswerText: "Paris" }],
    });

    expect(deps.prisma.client.quiz.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          questions: {
            create: [
              expect.objectContaining({
                type: "SHORT_ANSWER",
                correctAnswerText: "Paris",
                options: undefined,
              }),
            ],
          },
        }),
      }),
    );
  });

  it("never leaks correctAnswerText or isCorrect in the QUIZ_PUBLISHED broadcast", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.create("meeting-1", "teacher-1", {
      title: "Quick check",
      questions: [{ type: "SHORT_ANSWER", question: "Capital of France?", points: 2, correctAnswerText: "Paris" }],
    });

    const [, , payload] = (deps.broadcast.publish as jest.Mock).mock.calls[0];
    expect(JSON.stringify(payload)).not.toContain("Paris");
    expect(JSON.stringify(payload)).not.toContain("isCorrect");
  });
});

describe("QuizzesService.answer — SHORT_ANSWER grading", () => {
  const shortAnswerQuestion = {
    id: "q-1",
    quizId: "quiz-1",
    type: "SHORT_ANSWER",
    points: 5,
    correctAnswerText: "Paris",
    options: [],
    quiz: { meetingId: "meeting-1", status: "OPEN" },
  };

  it("grades a case-insensitive, whitespace-trimmed exact match as correct", async () => {
    const deps = makeDeps({ question: shortAnswerQuestion });
    const service = makeService(deps);

    const result = await service.answer("meeting-1", "student-1", "quiz-1", "q-1", { answerText: "  paris  " });

    expect(result).toEqual({ isCorrect: true, pointsAwarded: 5 });
  });

  it("grades a non-matching answer as incorrect with zero points", async () => {
    const deps = makeDeps({ question: shortAnswerQuestion });
    const service = makeService(deps);

    const result = await service.answer("meeting-1", "student-1", "quiz-1", "q-1", { answerText: "London" });

    expect(result).toEqual({ isCorrect: false, pointsAwarded: 0 });
  });

  it("rejects a selectedOptionId submitted against a SHORT_ANSWER question", async () => {
    const deps = makeDeps({ question: shortAnswerQuestion });
    const service = makeService(deps);

    await expect(
      service.answer("meeting-1", "student-1", "quiz-1", "q-1", { selectedOptionId: "opt-1" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("QuizzesService.answer — option-based grading (MULTIPLE_CHOICE/TRUE_FALSE)", () => {
  const trueFalseQuestion = {
    id: "q-1",
    quizId: "quiz-1",
    type: "TRUE_FALSE",
    points: 3,
    correctAnswerText: null,
    options: [
      { id: "opt-true", isCorrect: true },
      { id: "opt-false", isCorrect: false },
    ],
    quiz: { meetingId: "meeting-1", status: "OPEN" },
  };

  it("grades the correct option as correct", async () => {
    const deps = makeDeps({ question: trueFalseQuestion });
    const service = makeService(deps);

    const result = await service.answer("meeting-1", "student-1", "quiz-1", "q-1", {
      selectedOptionId: "opt-true",
    });

    expect(result).toEqual({ isCorrect: true, pointsAwarded: 3 });
  });

  it("rejects answerText submitted against an option-based question", async () => {
    const deps = makeDeps({ question: trueFalseQuestion });
    const service = makeService(deps);

    await expect(
      service.answer("meeting-1", "student-1", "quiz-1", "q-1", { answerText: "true" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
