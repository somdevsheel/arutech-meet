import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { nanoid } from "nanoid";
import type { Env } from "@arutech/config";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";

const INVITE_TTL_DAYS = 7;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "org"
  );
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    @Inject("ENV") private readonly env: Env,
  ) {}

  async create(userId: string, name: string) {
    const baseSlug = slugify(name);
    let slug = baseSlug;
    let suffix = 1;
    while (await this.prisma.client.organization.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${++suffix}`;
    }

    return this.prisma.client.organization.create({
      data: {
        name,
        slug,
        ownerUserId: userId,
        memberships: { create: { userId, role: "OWNER" } },
      },
    });
  }

  async listMine(userId: string) {
    return this.prisma.client.organization.findMany({
      where: { deletedAt: null, memberships: { some: { userId } } },
      orderBy: { createdAt: "desc" },
    });
  }

  private async requireMembership(orgId: string, userId: string) {
    const membership = await this.prisma.client.membership.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!membership) throw new ForbiddenException("Not a member of this organization");
    return membership;
  }

  private async requireManager(orgId: string, userId: string) {
    const membership = await this.requireMembership(orgId, userId);
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      throw new ForbiddenException("Only org owners/admins can do that");
    }
    return membership;
  }

  async findById(id: string, userId: string) {
    await this.requireMembership(id, userId);
    const org = await this.prisma.client.organization.findUnique({ where: { id } });
    if (!org || org.deletedAt) throw new NotFoundException("Organization not found");
    return org;
  }

  /** Full roster — every real service already calling `findById` only ever
   * got its own membership row, never the whole org's; this is what a real
   * member-management UI actually needs. */
  async listMembers(orgId: string, userId: string) {
    await this.requireMembership(orgId, userId);
    return this.prisma.client.membership.findMany({
      where: { orgId },
      include: { user: { select: { id: true, displayName: true, username: true, email: true, avatarUrl: true } } },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    });
  }

  /** Adds someone immediately, no acceptance step — kept for callers that
   * already know the target's account id (e.g. a future bulk-import tool).
   * `inviteByEmail` below is the real, acceptance-gated flow a human uses. */
  async addMember(orgId: string, actingUserId: string, targetUserId: string, role: "ADMIN" | "MEMBER") {
    await this.requireManager(orgId, actingUserId);
    const existing = await this.prisma.client.membership.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (existing) throw new ConflictException("User is already a member");

    return this.prisma.client.membership.create({
      data: { orgId, userId: targetUserId, role, invitedByUserId: actingUserId },
    });
  }

  async removeMember(orgId: string, actingUserId: string, targetUserId: string) {
    await this.requireManager(orgId, actingUserId);
    await this.assertNotSoleOwnerRemoval(orgId, targetUserId, "removed");
    await this.prisma.client.membership.delete({ where: { orgId_userId: { orgId, userId: targetUserId } } });
  }

  /** Self-service — a member can always leave their own org (unlike being
   * removed, no manager approval needed), but never the sole owner: that
   * would leave the org with nobody able to manage it at all. */
  async leaveOrg(orgId: string, userId: string) {
    await this.requireMembership(orgId, userId);
    await this.assertNotSoleOwnerRemoval(orgId, userId, "left");
    await this.prisma.client.membership.delete({ where: { orgId_userId: { orgId, userId } } });
  }

  private async assertNotSoleOwnerRemoval(orgId: string, targetUserId: string, verb: "removed" | "left") {
    const target = await this.prisma.client.membership.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (!target) throw new NotFoundException("Not a member of this organization");
    if (target.role !== "OWNER") return;
    const ownerCount = await this.prisma.client.membership.count({ where: { orgId, role: "OWNER" } });
    if (ownerCount <= 1) {
      throw new ForbiddenException(`Can't be ${verb} — this is the organization's only owner`);
    }
  }

  /** Only an OWNER can grant/revoke OWNER or ADMIN — an ADMIN promoting
   * someone else to ADMIN (or itself to OWNER) is exactly the privilege
   * escalation this restricts. */
  async updateMemberRole(orgId: string, actingUserId: string, targetUserId: string, role: "OWNER" | "ADMIN" | "MEMBER") {
    const acting = await this.requireMembership(orgId, actingUserId);
    if (acting.role !== "OWNER") throw new ForbiddenException("Only an org owner can change member roles");
    const target = await this.prisma.client.membership.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (!target) throw new NotFoundException("Not a member of this organization");
    if (target.role === "OWNER" && role !== "OWNER") {
      const ownerCount = await this.prisma.client.membership.count({ where: { orgId, role: "OWNER" } });
      if (ownerCount <= 1) throw new ForbiddenException("Can't demote the organization's only owner");
    }
    return this.prisma.client.membership.update({
      where: { orgId_userId: { orgId, userId: targetUserId } },
      data: { role },
    });
  }

  /** Owner/admin, same bar as `addMember`/`inviteByEmail` — branding isn't
   * the privilege-escalation-sensitive kind of change `updateMemberRole`
   * guards (owner-only), just ordinary org configuration. Every field is
   * independently nullable so a manager can clear just the logo, or just
   * the message, without resending the others. Lives directly on
   * `Organization` (like `logoUrl`/`brandColor` already did) rather than a
   * separate settings table — same "extend the row, don't add a 1:1 model"
   * call this codebase already made for the per-org limits in Stage 28. */
  async updateBranding(
    orgId: string,
    actingUserId: string,
    data: { logoUrl?: string | null; brandColor?: string | null; joinPageMessage?: string | null },
  ) {
    await this.requireManager(orgId, actingUserId);
    return this.prisma.client.organization.update({
      where: { id: orgId },
      data: {
        ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
        ...(data.brandColor !== undefined && { brandColor: data.brandColor }),
        ...(data.joinPageMessage !== undefined && { joinPageMessage: data.joinPageMessage }),
      },
    });
  }

  // --- Invite by email -------------------------------------------------

  async listInvites(orgId: string, actingUserId: string) {
    await this.requireManager(orgId, actingUserId);
    return this.prisma.client.organizationInvite.findMany({
      where: { orgId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
  }

  async inviteByEmail(orgId: string, actingUserId: string, email: string, role: "ADMIN" | "MEMBER") {
    await this.requireManager(orgId, actingUserId);
    const org = await this.prisma.client.organization.findUniqueOrThrow({ where: { id: orgId } });

    const existingUser = await this.prisma.client.user.findUnique({ where: { email } });
    if (existingUser) {
      const alreadyMember = await this.prisma.client.membership.findUnique({
        where: { orgId_userId: { orgId, userId: existingUser.id } },
      });
      if (alreadyMember) throw new ConflictException("This person is already a member");
    }

    const inviter = await this.prisma.client.user.findUniqueOrThrow({ where: { id: actingUserId } });
    const token = nanoid(32);
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    // A still-PENDING invite for the same email gets refreshed in place
    // (new token, new expiry, resent) rather than erroring — inviting
    // someone twice before they've responded is a normal thing to do, not a
    // conflict worth blocking on.
    const existingInvite = await this.prisma.client.organizationInvite.findFirst({
      where: { orgId, email, status: "PENDING" },
    });
    const invite = existingInvite
      ? await this.prisma.client.organizationInvite.update({
          where: { id: existingInvite.id },
          data: { role, token, expiresAt, invitedByUserId: actingUserId },
        })
      : await this.prisma.client.organizationInvite.create({
          data: { orgId, email, role, token, expiresAt, invitedByUserId: actingUserId },
        });

    const acceptUrl = `${this.env.WEB_URL}/organizations/invites/${token}`;
    // Email delivery failing shouldn't undo a real invite row that was
    // already created — the invitee can still be told in-app (if they have
    // an account) or re-sent later; log and continue rather than throwing
    // through to the controller as a 500 for what's fundamentally a
    // best-effort notification channel.
    await this.mail
      .sendOrganizationInvite({ to: email, orgName: org.name, inviterName: inviter.displayName, acceptUrl })
      .catch(() => {});

    if (existingUser) {
      await this.notifications.create({
        userId: existingUser.id,
        type: "ORG_INVITE",
        title: `Invitation to join ${org.name}`,
        body: `${inviter.displayName} invited you to join ${org.name}.`,
        data: { token, orgId, orgName: org.name },
      });
    }

    return invite;
  }

  async revokeInvite(orgId: string, actingUserId: string, inviteId: string) {
    await this.requireManager(orgId, actingUserId);
    const invite = await this.prisma.client.organizationInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.orgId !== orgId) throw new NotFoundException("Invite not found");
    await this.prisma.client.organizationInvite.update({
      where: { id: inviteId },
      data: { status: "REVOKED" },
    });
  }

  /** Only the account whose email actually matches the invite can accept it
   * — a token alone isn't treated as sufficient, precisely so a leaked/
   * forwarded invite link can't be redeemed by anyone other than the
   * person it was actually sent to. */
  async acceptInvite(token: string, userId: string) {
    const invite = await this.prisma.client.organizationInvite.findUnique({ where: { token } });
    if (!invite) throw new NotFoundException("Invite not found");
    if (invite.status !== "PENDING") throw new ConflictException(`This invite has already been ${invite.status.toLowerCase()}`);
    if (invite.expiresAt < new Date()) {
      await this.prisma.client.organizationInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
      throw new ConflictException("This invite has expired");
    }
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new ForbiddenException("This invite was sent to a different email address");
    }

    const existing = await this.prisma.client.membership.findUnique({
      where: { orgId_userId: { orgId: invite.orgId, userId } },
    });
    await this.prisma.client.organizationInvite.update({ where: { id: invite.id }, data: { status: "ACCEPTED" } });
    if (existing) return existing; // already a member somehow — just mark the invite settled

    return this.prisma.client.membership.create({
      data: { orgId: invite.orgId, userId, role: invite.role, invitedByUserId: invite.invitedByUserId },
    });
  }

  /** Read-only preview for the accept-invite page before the viewer commits
   * to anything — org name, who invited them, whether it's still valid — no
   * membership check needed since nothing here is sensitive per-org data. */
  async previewInvite(token: string) {
    const invite = await this.prisma.client.organizationInvite.findUnique({
      where: { token },
      include: { organization: { select: { name: true } }, invitedBy: { select: { displayName: true } } },
    });
    if (!invite) throw new NotFoundException("Invite not found");
    return {
      orgName: invite.organization.name,
      inviterName: invite.invitedBy.displayName,
      email: invite.email,
      status: invite.status,
      expired: invite.status === "PENDING" && invite.expiresAt < new Date(),
    };
  }

  // --- Per-org limits, actually enforced --------------------------------

  /** Checked at meeting *creation* time, only when the meeting is explicitly
   * created under an org (`dto.orgId` set) — a personal meeting has no org
   * context to check against. "Concurrent" means genuinely LIVE right now,
   * not merely scheduled/waiting, matching how a seat/concurrency limit is
   * meant to read. */
  async assertMeetingConcurrencyOk(orgId: string): Promise<void> {
    const org = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { meetingConcurrencyLimit: true, name: true },
    });
    const liveCount = await this.prisma.client.meeting.count({
      where: { orgId, status: "LIVE", deletedAt: null },
    });
    if (liveCount >= org.meetingConcurrencyLimit) {
      throw new ForbiddenException(
        `${org.name} has reached its concurrent-meeting limit (${org.meetingConcurrencyLimit}). End an active meeting before starting another.`,
      );
    }
  }

  /** Checked at upload *presign* time (before the file exists in storage),
   * scoped to `FileAsset` only — the one upload path with a known size
   * up front. Server-side recordings deliberately aren't checked here: a
   * recording's final size isn't known until Egress finishes, and starting
   * one is already a host-only action; blocking it on a size estimate would
   * be a different, larger piece of work than this pass covers. */
  async assertStorageOk(orgId: string, additionalBytes: number): Promise<void> {
    const org = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { storageLimitBytes: true, name: true },
    });
    const usage = await this.prisma.client.fileAsset.aggregate({
      where: { orgId, deletedAt: null },
      _sum: { sizeBytes: true },
    });
    const used = usage._sum.sizeBytes ?? BigInt(0);
    if (used + BigInt(additionalBytes) > org.storageLimitBytes) {
      throw new ForbiddenException(
        `${org.name} has reached its storage limit (${formatBytes(org.storageLimitBytes)}).`,
      );
    }
  }
}

function formatBytes(n: bigint): string {
  const gb = Number(n) / 1024 / 1024 / 1024;
  return `${gb.toFixed(1)} GB`;
}
