import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

function rate(used: number, total: number): number {
  return total === 0 ? 0 : Math.round((used / total) * 1000) / 10; // one decimal percent
}

/**
 * Per-feature engagement — deliberately distinct from `AdminStatsService`'s
 * existing aggregate counts (total meetings, total recordings, etc.), which
 * answer "how much of X exists" not "what fraction of meetings actually
 * used feature Y". Concrete, not vague, per the roadmap's own instruction
 * to decide what "feature usage" means before building anything: six
 * features (whiteboard, polls, quizzes, breakout rooms, recording, live
 * captions), each reporting how many meetings in the window used it at
 * least once, that as a rate of total meetings, and a feature-appropriate
 * volume figure (polls/quizzes also get response counts — the closest real
 * analogue to the roadmap's own "poll-response-rate" example).
 *
 * Every number here is a plain aggregate `count`/`groupBy` over tables that
 * already exist for their own real reason (Whiteboard, Poll, Quiz,
 * BreakoutRoom, MeetingRecording, and — new this stage — a single
 * `CAPTIONS_STARTED` `MeetingEvent` row written at the moment captions are
 * actually dispatched, the one durable signal captions ever leaves behind
 * since the caption text itself never touches this database). No new
 * per-user tracking table, no new personal data collected beyond that one
 * event, and nothing here is retained longer or more granularly than the
 * feature's own data already was — see docs/roadmap.md's Advanced
 * analytics stage for why this scope was chosen deliberately, not by
 * default.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getFeatureEngagement(days: number) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const meetingWhere = { deletedAt: null, createdAt: { gte: since } } as const;

    const [
      totalMeetings,
      whiteboardsCreated,
      meetingsWithWhiteboard,
      pollsPublished,
      pollResponses,
      meetingsWithPoll,
      quizzesPublished,
      quizAnswers,
      meetingsWithQuiz,
      breakoutRoomsCreated,
      meetingsWithBreakoutRooms,
      meetingsWithRecording,
      captionsStarts,
      meetingsWithCaptions,
    ] = await Promise.all([
      this.prisma.client.meeting.count({ where: meetingWhere }),
      this.prisma.client.whiteboard.count({ where: { meeting: meetingWhere } }),
      this.prisma.client.meeting.count({ where: { ...meetingWhere, whiteboards: { some: {} } } }),
      this.prisma.client.poll.count({ where: { meeting: meetingWhere, status: { not: "DRAFT" } } }),
      this.prisma.client.pollResponse.count({ where: { poll: { meeting: meetingWhere } } }),
      this.prisma.client.meeting.count({ where: { ...meetingWhere, polls: { some: { status: { not: "DRAFT" } } } } }),
      this.prisma.client.quiz.count({ where: { meeting: meetingWhere, status: { not: "DRAFT" } } }),
      this.prisma.client.quizAnswer.count({ where: { question: { quiz: { meeting: meetingWhere } } } }),
      this.prisma.client.meeting.count({ where: { ...meetingWhere, quizzes: { some: { status: { not: "DRAFT" } } } } }),
      this.prisma.client.breakoutRoom.count({ where: { meeting: meetingWhere } }),
      this.prisma.client.meeting.count({ where: { ...meetingWhere, breakoutRooms: { some: {} } } }),
      this.prisma.client.meeting.count({ where: { ...meetingWhere, recordings: { some: { deletedAt: null } } } }),
      this.prisma.client.meetingEvent.count({ where: { type: "CAPTIONS_STARTED", meeting: meetingWhere } }),
      this.prisma.client.meeting.count({ where: { ...meetingWhere, events: { some: { type: "CAPTIONS_STARTED" } } } }),
    ]);

    return {
      windowDays: days,
      totalMeetings,
      whiteboard: {
        meetingsUsed: meetingsWithWhiteboard,
        adoptionRate: rate(meetingsWithWhiteboard, totalMeetings),
        totalCreated: whiteboardsCreated,
      },
      polls: {
        meetingsUsed: meetingsWithPoll,
        adoptionRate: rate(meetingsWithPoll, totalMeetings),
        totalPublished: pollsPublished,
        totalResponses: pollResponses,
        avgResponsesPerPoll: pollsPublished === 0 ? 0 : Math.round((pollResponses / pollsPublished) * 10) / 10,
      },
      quizzes: {
        meetingsUsed: meetingsWithQuiz,
        adoptionRate: rate(meetingsWithQuiz, totalMeetings),
        totalPublished: quizzesPublished,
        totalAnswers: quizAnswers,
        avgAnswersPerQuiz: quizzesPublished === 0 ? 0 : Math.round((quizAnswers / quizzesPublished) * 10) / 10,
      },
      breakoutRooms: {
        meetingsUsed: meetingsWithBreakoutRooms,
        adoptionRate: rate(meetingsWithBreakoutRooms, totalMeetings),
        totalCreated: breakoutRoomsCreated,
      },
      recording: {
        meetingsUsed: meetingsWithRecording,
        adoptionRate: rate(meetingsWithRecording, totalMeetings),
      },
      liveCaptions: {
        meetingsUsed: meetingsWithCaptions,
        adoptionRate: rate(meetingsWithCaptions, totalMeetings),
        totalStarts: captionsStarts,
      },
    };
  }
}
