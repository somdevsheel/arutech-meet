import { AdminAnalyticsService } from "./admin-analytics.service";
import type { PrismaService } from "../prisma/prisma.service";

function makeService(counts: Partial<Record<string, number>>) {
  const val = (key: string, fallback = 0) => counts[key] ?? fallback;
  const prisma = {
    client: {
      meeting: { count: jest.fn().mockResolvedValue(val("meeting")) },
      whiteboard: { count: jest.fn().mockResolvedValue(val("whiteboard")) },
      poll: { count: jest.fn().mockResolvedValue(val("poll")) },
      pollResponse: { count: jest.fn().mockResolvedValue(val("pollResponse")) },
      quiz: { count: jest.fn().mockResolvedValue(val("quiz")) },
      quizAnswer: { count: jest.fn().mockResolvedValue(val("quizAnswer")) },
      breakoutRoom: { count: jest.fn().mockResolvedValue(val("breakoutRoom")) },
      meetingEvent: { count: jest.fn().mockResolvedValue(val("meetingEvent")) },
    },
  } as unknown as PrismaService;

  // meeting.count is called 7 times (total + 6 "meetings that used X"); the
  // relation field present in `where` (besides deletedAt/createdAt) tells
  // us which one, so each call can return its own configured value.
  const RELATION_TO_KEY: Record<string, string> = {
    whiteboards: "meetingsWithWhiteboard",
    polls: "meetingsWithPoll",
    quizzes: "meetingsWithQuiz",
    breakoutRooms: "meetingsWithBreakoutRooms",
    recordings: "meetingsWithRecording",
    events: "meetingsWithCaptions",
  };
  (prisma.client.meeting.count as jest.Mock).mockImplementation((args: { where: Record<string, unknown> }) => {
    const relationKey = Object.keys(args.where).find((k) => k in RELATION_TO_KEY);
    const statsKey = relationKey ? RELATION_TO_KEY[relationKey] : undefined;
    return Promise.resolve(statsKey ? val(statsKey) : val("meeting"));
  });

  return { service: new AdminAnalyticsService(prisma), prisma };
}

describe("AdminAnalyticsService.getFeatureEngagement", () => {
  it("scopes every query to the requested window via Meeting.createdAt", async () => {
    const { service, prisma } = makeService({});
    await service.getFeatureEngagement(7);
    const call = (prisma.client.whiteboard.count as jest.Mock).mock.calls[0][0];
    const since = call.where.meeting.createdAt.gte as Date;
    const daysAgo = (Date.now() - since.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeGreaterThan(6.9);
    expect(daysAgo).toBeLessThan(7.1);
  });

  it("computes a whiteboard adoption rate as a percentage of total meetings", async () => {
    const { service } = makeService({ meeting: 20, meetingsWithWhiteboard: 5, whiteboard: 8 });
    const result = await service.getFeatureEngagement(30);
    expect(result.totalMeetings).toBe(20);
    expect(result.whiteboard).toEqual({ meetingsUsed: 5, adoptionRate: 25, totalCreated: 8 });
  });

  it("returns 0 rates instead of dividing by zero when there are no meetings in the window", async () => {
    const { service } = makeService({ meeting: 0 });
    const result = await service.getFeatureEngagement(30);
    expect(result.whiteboard.adoptionRate).toBe(0);
    expect(result.polls.adoptionRate).toBe(0);
    expect(result.polls.avgResponsesPerPoll).toBe(0);
  });

  it("computes avgResponsesPerPoll from totalResponses / totalPublished, not a raw count", async () => {
    const { service } = makeService({ poll: 4, pollResponse: 10 });
    const result = await service.getFeatureEngagement(30);
    expect(result.polls.totalPublished).toBe(4);
    expect(result.polls.totalResponses).toBe(10);
    expect(result.polls.avgResponsesPerPoll).toBe(2.5);
  });

  it("only counts polls/quizzes actually published — status != DRAFT — not every draft ever created", async () => {
    const { service, prisma } = makeService({});
    await service.getFeatureEngagement(30);
    expect(prisma.client.poll.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: "DRAFT" } }) }),
    );
    expect(prisma.client.quiz.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: "DRAFT" } }) }),
    );
  });

  it("reads live-captions adoption from the CAPTIONS_STARTED MeetingEvent, not a separate table", async () => {
    const { service, prisma } = makeService({ meetingEvent: 3 });
    const result = await service.getFeatureEngagement(30);
    expect(result.liveCaptions.totalStarts).toBe(3);
    expect(prisma.client.meetingEvent.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ type: "CAPTIONS_STARTED" }) }),
    );
  });
});
