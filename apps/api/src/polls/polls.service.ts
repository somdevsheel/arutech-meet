import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { WS_EVENTS } from "@arutech/types";
import type { CreatePollDto, RespondPollDto } from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";
import { PermissionService } from "../meetings/permission.service";
import { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";

@Injectable()
export class PollsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly broadcast: RealtimeBroadcastService,
  ) {}

  /** Creates a poll and immediately opens it for responses — this product has no
   * "drafted, not yet published" step (unlike quizzes' create-then-open would be
   * a reasonable follow-up if a teacher wants to prep polls in advance, but isn't
   * needed for the MVP loop of "ask a live question during a meeting"). */
  async create(meetingId: string, callerUserId: string, dto: CreatePollDto) {
    await this.permissions.requireCapability(meetingId, callerUserId, "poll.create");

    const poll = await this.prisma.client.poll.create({
      data: {
        meetingId,
        createdByUserId: callerUserId,
        question: dto.question,
        isMultipleChoice: dto.isMultipleChoice,
        showResultsToParticipants: dto.showResultsToParticipants,
        timerSeconds: dto.timerSeconds,
        status: "OPEN",
        options: { create: dto.options.map((text, order) => ({ text, order })) },
      },
      include: { options: true },
    });

    await this.broadcast.publish(meetingId, WS_EVENTS.POLL_PUBLISHED, this.toPayload(poll, []));
    return poll;
  }

  async respond(meetingId: string, callerUserId: string, pollId: string, dto: RespondPollDto) {
    await this.permissions.requireCapability(meetingId, callerUserId, "poll.respond");
    const poll = await this.getOrThrow(meetingId, pollId);
    if (poll.status !== "OPEN") throw new BadRequestException("This poll is closed");

    const validOptionIds = new Set(poll.options.map((o) => o.id));
    if (!dto.optionIds.every((id) => validOptionIds.has(id))) {
      throw new BadRequestException("Invalid option for this poll");
    }
    if (!poll.isMultipleChoice && dto.optionIds.length > 1) {
      throw new BadRequestException("This poll only accepts a single choice");
    }

    // Replace the caller's prior responses for this poll (simplest correct
    // semantics for both single- and multi-choice: always reflects their latest
    // submission rather than accumulating).
    await this.prisma.client.pollResponse.deleteMany({ where: { pollId, userId: callerUserId } });
    await this.prisma.client.pollResponse.createMany({
      data: dto.optionIds.map((optionId) => ({ pollId, optionId, userId: callerUserId })),
    });

    const results = await this.tally(pollId);
    await this.broadcast.publish(meetingId, WS_EVENTS.POLL_RESPONSE, {
      pollId,
      results: poll.showResultsToParticipants ? results : undefined,
      totalRespondents: await this.respondentCount(pollId),
    });
    return { ok: true };
  }

  async close(meetingId: string, callerUserId: string, pollId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "poll.create");
    await this.getOrThrow(meetingId, pollId);

    await this.prisma.client.poll.update({
      where: { id: pollId },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    const results = await this.tally(pollId);
    await this.broadcast.publish(meetingId, WS_EVENTS.POLL_CLOSED, { pollId, results });
    return { results };
  }

  async list(meetingId: string, callerUserId: string) {
    await this.permissions.getParticipant(meetingId, callerUserId);
    return this.prisma.client.poll.findMany({
      where: { meetingId },
      include: { options: true },
      orderBy: { createdAt: "desc" },
    });
  }

  private async getOrThrow(meetingId: string, pollId: string) {
    const poll = await this.prisma.client.poll.findUnique({
      where: { id: pollId },
      include: { options: true },
    });
    if (!poll || poll.meetingId !== meetingId) throw new NotFoundException("Poll not found");
    return poll;
  }

  private async tally(pollId: string) {
    const options = await this.prisma.client.pollOption.findMany({
      where: { pollId },
      include: { _count: { select: { responses: true } } },
    });
    return options.map((o) => ({ optionId: o.id, text: o.text, votes: o._count.responses }));
  }

  private async respondentCount(pollId: string): Promise<number> {
    const distinct = await this.prisma.client.pollResponse.findMany({
      where: { pollId },
      distinct: ["userId"],
      select: { userId: true },
    });
    return distinct.length;
  }

  private toPayload(poll: { id: string; question: string; isMultipleChoice: boolean; timerSeconds: number | null; options: { id: string; text: string; order: number }[] }, results: unknown[]) {
    return {
      id: poll.id,
      question: poll.question,
      isMultipleChoice: poll.isMultipleChoice,
      timerSeconds: poll.timerSeconds,
      options: poll.options.map((o) => ({ id: o.id, text: o.text, order: o.order })),
      results,
    };
  }
}
