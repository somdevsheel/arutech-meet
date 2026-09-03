import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * A sub-group within an Organization — the same relationship shape
 * `ChatRoom`/`Meeting` already have to a `Class` (Stage 6), extended here.
 * Distinct from Team *Chat* (`ChatRoom.type: GROUP`, Stage 23) — a personal,
 * informal chat group unrelated to any organization. See Team's own schema
 * comment for why that's a deliberate, not-conflated distinction.
 *
 * Any org member can create a team (becomes its sole `LEAD`) and can freely
 * join/leave any team in their org — teams are self-serve, lighter-weight
 * than org membership itself, not another invite-gated flow to duplicate
 * Stage 28's. Only a `LEAD` can rename/describe a team, remove someone else,
 * or promote/demote another member — all with the same "never leave it with
 * zero leads" protection Stage 28 already established for org owners.
 *
 * A team's chat/messages/attachments deliberately have no methods here at
 * all — `ChatService`'s room-scoped methods (`roomHistory`,
 * `persistRoomMessage`, `presignRoomAttachment`, ...) only ever check
 * `ChatMember` existence, never `ChatRoom.type` — so as long as this service
 * keeps `ChatMember` rows in sync with `TeamMember` rows, the entire chat
 * feature set (send, edit, delete, forward, voice messages, typing,
 * attachments) already works on a team's room for free, through the exact
 * same infrastructure Team Chat groups use. "Start a meeting" is likewise
 * client-side only, reusing the identical pattern Stage 23 shipped for Team
 * Chat groups (create a real `Meeting`, post the join link as a message) —
 * no new backend surface for either.
 */
@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireOrgMembership(orgId: string, userId: string) {
    const membership = await this.prisma.client.membership.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!membership) throw new ForbiddenException("Not a member of that organization");
    return membership;
  }

  private async getTeamOrThrow(teamId: string) {
    const team = await this.prisma.client.team.findUnique({
      where: { id: teamId },
      include: { chatRoom: true },
    });
    if (!team || team.deletedAt) throw new NotFoundException("Team not found");
    return team;
  }

  private async requireLead(teamId: string, userId: string) {
    const membership = await this.prisma.client.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!membership || membership.role !== "LEAD") {
      throw new ForbiddenException("Only a team lead can do that");
    }
    return membership;
  }

  private async assertNotSoleLeadRemoval(teamId: string, targetUserId: string, verb: "removed" | "left") {
    const target = await this.prisma.client.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: targetUserId } },
    });
    if (!target) throw new NotFoundException("Not a member of this team");
    if (target.role !== "LEAD") return;
    const leadCount = await this.prisma.client.teamMember.count({ where: { teamId, role: "LEAD" } });
    if (leadCount <= 1) {
      throw new ForbiddenException(`Can't be ${verb} — this is the team's only lead`);
    }
  }

  async create(orgId: string, callerUserId: string, data: { name: string; description?: string }) {
    await this.requireOrgMembership(orgId, callerUserId);
    return this.prisma.client.team.create({
      data: {
        orgId,
        name: data.name,
        description: data.description,
        createdByUserId: callerUserId,
        members: { create: { userId: callerUserId, role: "LEAD" } },
        chatRoom: {
          create: {
            type: "TEAM",
            createdById: callerUserId,
            members: { create: { userId: callerUserId } },
          },
        },
      },
      include: { chatRoom: true, members: true },
    });
  }

  async listForOrg(orgId: string, callerUserId: string) {
    await this.requireOrgMembership(orgId, callerUserId);
    return this.prisma.client.team.findMany({
      where: { orgId, deletedAt: null },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Any org member can view a team's details — including one they haven't
   * joined yet, so they can decide whether to. */
  async findById(teamId: string, callerUserId: string) {
    const team = await this.getTeamOrThrow(teamId);
    await this.requireOrgMembership(team.orgId, callerUserId);
    return team;
  }

  async listMembers(teamId: string, callerUserId: string) {
    const team = await this.getTeamOrThrow(teamId);
    await this.requireOrgMembership(team.orgId, callerUserId);
    return this.prisma.client.teamMember.findMany({
      where: { teamId },
      include: { user: { select: { id: true, displayName: true, username: true, avatarUrl: true } } },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    });
  }

  async update(teamId: string, callerUserId: string, data: { name?: string; description?: string }) {
    await this.requireLead(teamId, callerUserId);
    return this.prisma.client.team.update({ where: { id: teamId }, data });
  }

  async join(teamId: string, callerUserId: string) {
    const team = await this.getTeamOrThrow(teamId);
    await this.requireOrgMembership(team.orgId, callerUserId);
    const existing = await this.prisma.client.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: callerUserId } },
    });
    if (existing) throw new ConflictException("Already a member of this team");

    const [membership] = await this.prisma.client.$transaction([
      this.prisma.client.teamMember.create({ data: { teamId, userId: callerUserId, role: "MEMBER" } }),
      this.prisma.client.chatMember.create({
        data: { chatRoomId: team.chatRoom!.id, userId: callerUserId },
      }),
    ]);
    return membership;
  }

  // The class doc comment above calls teams "self-serve" by design — any
  // org member can freely join one themselves, deliberately not another
  // invite-gated flow to duplicate the org's own. In practice that meant a
  // lead had genuinely no way to get a specific person in at all beyond
  // telling them out-of-band "go to this URL and click Join": there's no
  // team directory anyone would stumble across, no notification a new team
  // exists, nothing. Self-serve join stays (it's still the lighter path for
  // someone who already knows they want in), but a lead can now also just
  // add someone directly — the same direct-add OrganizationsService.
  // addMember already offers alongside its own invite-by-email flow, for
  // exactly this "I already know who I want, skip the ceremony" case.
  async addMember(teamId: string, callerUserId: string, targetUserId: string) {
    const team = await this.getTeamOrThrow(teamId);
    await this.requireLead(teamId, callerUserId);
    // Can't add someone who isn't even in the parent org — a team is a
    // sub-group of org members, not its own independent invite surface.
    const orgMembership = await this.prisma.client.membership.findUnique({
      where: { orgId_userId: { orgId: team.orgId, userId: targetUserId } },
    });
    if (!orgMembership) throw new ForbiddenException("That person isn't a member of this organization");

    const existing = await this.prisma.client.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: targetUserId } },
    });
    if (existing) throw new ConflictException("Already a member of this team");

    const [membership] = await this.prisma.client.$transaction([
      this.prisma.client.teamMember.create({ data: { teamId, userId: targetUserId, role: "MEMBER" } }),
      this.prisma.client.chatMember.create({
        data: { chatRoomId: team.chatRoom!.id, userId: targetUserId },
      }),
    ]);
    return membership;
  }

  async leave(teamId: string, callerUserId: string) {
    const team = await this.getTeamOrThrow(teamId);
    await this.assertNotSoleLeadRemoval(teamId, callerUserId, "left");
    await this.prisma.client.$transaction([
      this.prisma.client.teamMember.delete({ where: { teamId_userId: { teamId, userId: callerUserId } } }),
      this.prisma.client.chatMember.deleteMany({
        where: { chatRoomId: team.chatRoom!.id, userId: callerUserId },
      }),
    ]);
  }

  async removeMember(teamId: string, callerUserId: string, targetUserId: string) {
    const team = await this.getTeamOrThrow(teamId);
    await this.requireLead(teamId, callerUserId);
    await this.assertNotSoleLeadRemoval(teamId, targetUserId, "removed");
    await this.prisma.client.$transaction([
      this.prisma.client.teamMember.delete({ where: { teamId_userId: { teamId, userId: targetUserId } } }),
      this.prisma.client.chatMember.deleteMany({
        where: { chatRoomId: team.chatRoom!.id, userId: targetUserId },
      }),
    ]);
  }

  async updateMemberRole(teamId: string, callerUserId: string, targetUserId: string, role: "LEAD" | "MEMBER") {
    await this.requireLead(teamId, callerUserId);
    const target = await this.prisma.client.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: targetUserId } },
    });
    if (!target) throw new NotFoundException("Not a member of this team");
    if (target.role === "LEAD" && role !== "LEAD") {
      const leadCount = await this.prisma.client.teamMember.count({ where: { teamId, role: "LEAD" } });
      if (leadCount <= 1) throw new ForbiddenException("Can't demote the team's only lead");
    }
    return this.prisma.client.teamMember.update({
      where: { teamId_userId: { teamId, userId: targetUserId } },
      data: { role },
    });
  }

  async delete(teamId: string, callerUserId: string) {
    await this.requireLead(teamId, callerUserId);
    await this.prisma.client.team.update({ where: { id: teamId }, data: { deletedAt: new Date() } });
  }
}
