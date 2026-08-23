import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface Contact {
  id: string;
  displayName: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  meetingsTogether: number;
  lastMetAt: string;
  isFavorite: boolean;
  groupIds: string[];
}

const USER_SELECT = { id: true, displayName: true, username: true, email: true, avatarUrl: true } as const;

/**
 * "Contacts" is derived entirely from real meeting history — everyone who has
 * actually joined a meeting alongside the caller — rather than a separate
 * address book a user has to populate by hand. There's no "add contact" model:
 * the directory is always exactly who you've met, always up to date.
 *
 * Block/favorite/group are the exception — genuinely per-user state that
 * can't be derived from anything, so those three get real tables
 * (BlockedUser/ContactFavorite/ContactGroup(Member) — see the schema
 * comment). Blocked users are filtered out of `list()` entirely (matching
 * how most chat/calling products hide a blocked person from your main
 * contact list, not just disable buttons on their row) — `listBlocked` is
 * the separate "manage who I've blocked" view.
 */
@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<Contact[]> {
    const myMeetings = await this.prisma.client.meetingParticipant.findMany({
      where: { userId, status: { in: ["JOINED", "LEFT"] } },
      select: { meetingId: true },
    });
    const meetingIds = [...new Set(myMeetings.map((m) => m.meetingId))];
    if (meetingIds.length === 0) return [];

    const [coParticipants, blockedEitherDirection, favorites, groupMemberships] = await Promise.all([
      this.prisma.client.meetingParticipant.findMany({
        where: { meetingId: { in: meetingIds }, userId: { not: userId }, status: { in: ["JOINED", "LEFT"] } },
        include: { user: { select: USER_SELECT } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.client.blockedUser.findMany({
        where: { OR: [{ blockerUserId: userId }, { blockedUserId: userId }] },
      }),
      this.prisma.client.contactFavorite.findMany({ where: { userId } }),
      this.prisma.client.contactGroupMember.findMany({
        where: { group: { ownerUserId: userId } },
        select: { contactUserId: true, groupId: true },
      }),
    ]);

    const blockedIds = new Set(
      blockedEitherDirection.map((b) => (b.blockerUserId === userId ? b.blockedUserId : b.blockerUserId)),
    );
    const favoriteIds = new Set(favorites.map((f) => f.contactUserId));
    const groupIdsByContact = new Map<string, string[]>();
    for (const m of groupMemberships) {
      const list = groupIdsByContact.get(m.contactUserId) ?? [];
      list.push(m.groupId);
      groupIdsByContact.set(m.contactUserId, list);
    }

    const byUser = new Map<string, Contact>();
    for (const p of coParticipants) {
      if (!p.user) continue; // guest, not a real contact to list
      if (blockedIds.has(p.user.id)) continue;
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
          isFavorite: favoriteIds.has(p.user.id),
          groupIds: groupIdsByContact.get(p.user.id) ?? [],
        });
      }
    }

    return [...byUser.values()].sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      return a.lastMetAt < b.lastMetAt ? 1 : -1;
    });
  }

  // ── Block ──────────────────────────────────────────────────────────────

  async block(userId: string, targetUserId: string): Promise<void> {
    if (userId === targetUserId) throw new BadRequestException("You can't block yourself");
    await this.prisma.client.blockedUser.upsert({
      where: { blockerUserId_blockedUserId: { blockerUserId: userId, blockedUserId: targetUserId } },
      create: { blockerUserId: userId, blockedUserId: targetUserId },
      update: {},
    });
  }

  async unblock(userId: string, targetUserId: string): Promise<void> {
    await this.prisma.client.blockedUser.deleteMany({
      where: { blockerUserId: userId, blockedUserId: targetUserId },
    });
  }

  async listBlocked(userId: string) {
    const rows = await this.prisma.client.blockedUser.findMany({
      where: { blockerUserId: userId },
      include: { blocked: { select: USER_SELECT } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => r.blocked);
  }

  /** Symmetric — see the class doc comment. Used by CallsService/ChatService
   * to reject a call/DM between two users with a block relationship in
   * either direction. */
  async isBlocked(userId: string, otherUserId: string): Promise<boolean> {
    const block = await this.prisma.client.blockedUser.findFirst({
      where: {
        OR: [
          { blockerUserId: userId, blockedUserId: otherUserId },
          { blockerUserId: otherUserId, blockedUserId: userId },
        ],
      },
    });
    return Boolean(block);
  }

  // ── Favorites ──────────────────────────────────────────────────────────

  async favorite(userId: string, targetUserId: string): Promise<void> {
    await this.prisma.client.contactFavorite.upsert({
      where: { userId_contactUserId: { userId, contactUserId: targetUserId } },
      create: { userId, contactUserId: targetUserId },
      update: {},
    });
  }

  async unfavorite(userId: string, targetUserId: string): Promise<void> {
    await this.prisma.client.contactFavorite.deleteMany({ where: { userId, contactUserId: targetUserId } });
  }

  // ── Groups ─────────────────────────────────────────────────────────────

  async createGroup(userId: string, name: string) {
    return this.prisma.client.contactGroup.create({ data: { ownerUserId: userId, name } });
  }

  async listGroups(userId: string) {
    return this.prisma.client.contactGroup.findMany({
      where: { ownerUserId: userId },
      include: { members: { include: { contact: { select: USER_SELECT } } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async deleteGroup(userId: string, groupId: string): Promise<void> {
    const group = await this.requireOwnedGroup(groupId, userId);
    await this.prisma.client.contactGroup.delete({ where: { id: group.id } });
  }

  async addToGroup(userId: string, groupId: string, contactUserId: string) {
    const group = await this.requireOwnedGroup(groupId, userId);
    const existing = await this.prisma.client.contactGroupMember.findUnique({
      where: { groupId_contactUserId: { groupId: group.id, contactUserId } },
    });
    if (existing) throw new ConflictException("Already in this group");
    return this.prisma.client.contactGroupMember.create({ data: { groupId: group.id, contactUserId } });
  }

  async removeFromGroup(userId: string, groupId: string, contactUserId: string): Promise<void> {
    const group = await this.requireOwnedGroup(groupId, userId);
    await this.prisma.client.contactGroupMember.deleteMany({ where: { groupId: group.id, contactUserId } });
  }

  private async requireOwnedGroup(groupId: string, userId: string) {
    const group = await this.prisma.client.contactGroup.findUnique({ where: { id: groupId } });
    if (!group || group.ownerUserId !== userId) throw new NotFoundException("Contact group not found");
    return group;
  }
}
