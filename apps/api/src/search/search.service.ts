import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface SearchResults {
  meetings: { id: string; code: string; title: string; status: string }[];
  contacts: { id: string; displayName: string; username: string; avatarUrl: string | null }[];
  notes: { id: string; title: string }[];
}

/** Backs the topbar search box — three real, scoped-to-the-caller queries
 * (never a cross-user search), not a mocked results list. */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(userId: string, query: string): Promise<SearchResults> {
    const q = query.trim();
    if (q.length < 2) return { meetings: [], contacts: [], notes: [] };

    const [meetings, notes, coParticipants] = await Promise.all([
      this.prisma.client.meeting.findMany({
        where: {
          deletedAt: null,
          OR: [{ ownerId: userId }, { participants: { some: { userId } } }],
          AND: { OR: [{ title: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] },
        },
        select: { id: true, code: true, title: true, status: true },
        take: 8,
      }),
      this.prisma.client.note.findMany({
        where: { userId, deletedAt: null, title: { contains: q, mode: "insensitive" } },
        select: { id: true, title: true },
        take: 8,
      }),
      // Same "co-participant" definition ContactsService uses, filtered by name/username/email.
      this.prisma.client.meetingParticipant.findMany({
        where: {
          userId: { not: userId },
          status: { in: ["JOINED", "LEFT"] },
          meeting: { participants: { some: { userId, status: { in: ["JOINED", "LEFT"] } } } },
          user: {
            OR: [
              { displayName: { contains: q, mode: "insensitive" } },
              { username: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          },
        },
        include: { user: { select: { id: true, displayName: true, username: true, avatarUrl: true } } },
        take: 20,
      }),
    ]);

    const contactsById = new Map<string, SearchResults["contacts"][number]>();
    for (const p of coParticipants) {
      if (p.user && !contactsById.has(p.user.id)) contactsById.set(p.user.id, p.user);
    }

    return { meetings, notes, contacts: [...contactsById.values()].slice(0, 8) };
  }
}
