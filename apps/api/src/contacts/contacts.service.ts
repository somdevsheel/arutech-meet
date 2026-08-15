import { Injectable, NotFoundException } from "@nestjs/common";
import { createMeetingSchema } from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";
import { MeetingsService } from "../meetings/meetings.service";
import { NotificationsService } from "../notifications/notifications.service";

export interface Contact {
  id: string;
  displayName: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  meetingsTogether: number;
  lastMetAt: string;
}

/**
 * "Contacts" is derived entirely from real meeting history — everyone who has
 * actually joined a meeting alongside the caller — rather than a separate
 * address book a user has to populate by hand. There's no "add contact" model:
 * the directory is always exactly who you've met, always up to date.
 */
@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly meetings: MeetingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(userId: string): Promise<Contact[]> {
    const myMeetings = await this.prisma.client.meetingParticipant.findMany({
      where: { userId, status: { in: ["JOINED", "LEFT"] } },
      select: { meetingId: true },
    });
    const meetingIds = [...new Set(myMeetings.map((m) => m.meetingId))];
    if (meetingIds.length === 0) return [];

    const coParticipants = await this.prisma.client.meetingParticipant.findMany({
      where: {
        meetingId: { in: meetingIds },
        userId: { not: userId },
        status: { in: ["JOINED", "LEFT"] },
      },
      include: {
        user: { select: { id: true, displayName: true, username: true, email: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const byUser = new Map<string, Contact>();
    for (const p of coParticipants) {
      if (!p.user) continue; // guest, not a real contact to list
      const existing = byUser.get(p.user.id);
      const metAt = (p.joinedAt ?? p.createdAt).toISOString();
      if (existing) {
        existing.meetingsTogether += 1;
        if (metAt > existing.lastMetAt) existing.lastMetAt = metAt;
      } else {
        byUser.set(p.user.id, {
          id: p.user.id,
          displayName: p.user.displayName,
          username: p.user.username,
          email: p.user.email,
          avatarUrl: p.user.avatarUrl,
          meetingsTogether: 1,
          lastMetAt: metAt,
        });
      }
    }

    return [...byUser.values()].sort((a, b) => (a.lastMetAt < b.lastMetAt ? 1 : -1));
  }

  /** Calling a contact reuses the meeting engine rather than a second, parallel
   * implementation — see docs/architecture.md's stated rationale for Calls.
   * Scoped honestly: this creates an instant meeting and pushes the callee a
   * real (persisted + live) notification with the join link, which they act on
   * from their own client. There's no live ringing/accept-decline signaling
   * (the Call/CallParticipant models exist in the schema for that but have no
   * service built around them yet) — what's here is real end to end, just a
   * smaller slice of "calling" than a phone-style ring/answer flow. */
  async call(callerId: string, contactUserId: string) {
    const contact = await this.prisma.client.user.findUnique({ where: { id: contactUserId } });
    if (!contact || contact.deletedAt) throw new NotFoundException("User not found");
    const caller = await this.prisma.client.user.findUniqueOrThrow({ where: { id: callerId } });

    // Named from both sides at once ("A and B"), not "Call with {caller}" —
    // that reads backwards in the caller's own meeting list (it names
    // themselves), and "Call with {callee}" would do the same to the callee.
    const dto = createMeetingSchema.parse({
      title: `${caller.displayName} and ${contact.displayName}`,
      type: "INSTANT",
    });
    const meeting = await this.meetings.create(callerId, dto);

    await this.notifications.create({
      userId: contactUserId,
      type: "CALL_INCOMING",
      title: `${caller.displayName} is calling you`,
      body: "Join now to answer.",
      data: { meetingId: meeting.id, meetingCode: meeting.code },
    });

    return meeting;
  }
}
