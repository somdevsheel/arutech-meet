import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { OrganizationsService } from "./organizations.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { MailService } from "../mail/mail.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { Env } from "@arutech/config";

const ORG = { id: "org-1", name: "Acme", storageLimitBytes: BigInt(1_000_000), meetingConcurrencyLimit: 5 };
const OWNER_MEMBERSHIP = { orgId: "org-1", userId: "owner-1", role: "OWNER" as const };
const ADMIN_MEMBERSHIP = { orgId: "org-1", userId: "admin-1", role: "ADMIN" as const };
const MEMBER_MEMBERSHIP = { orgId: "org-1", userId: "member-1", role: "MEMBER" as const };

function makeService(overrides?: {
  memberships?: Record<string, unknown>;
  invite?: unknown;
  existingUser?: unknown;
  ownerCount?: number;
}) {
  const membershipsByUser: Record<string, unknown> = {
    "owner-1": OWNER_MEMBERSHIP,
    "admin-1": ADMIN_MEMBERSHIP,
    "member-1": MEMBER_MEMBERSHIP,
    ...overrides?.memberships,
  };

  const prisma = {
    client: {
      organization: {
        findUnique: jest.fn().mockResolvedValue(ORG),
        findUniqueOrThrow: jest.fn().mockResolvedValue(ORG),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(ORG),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...ORG, ...data })),
      },
      membership: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { orgId_userId: { userId: string } } }) =>
          Promise.resolve(membershipsByUser[where.orgId_userId.userId] ?? null),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "membership-1", ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "membership-1", ...data })),
        delete: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(overrides?.ownerCount ?? 1),
      },
      organizationInvite: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(overrides?.invite ?? null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "invite-1", status: "PENDING", ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "invite-1", ...data })),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(overrides?.existingUser ?? null),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "user-x", email: "invitee@example.com", displayName: "Invitee" }),
      },
      meeting: { count: jest.fn().mockResolvedValue(0) },
      fileAsset: { aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: BigInt(0) } }) },
    },
  } as unknown as PrismaService;
  const mail = { sendOrganizationInvite: jest.fn().mockResolvedValue(undefined) } as unknown as MailService;
  const notifications = { create: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
  const env = { WEB_URL: "http://localhost:3000" } as unknown as Env;

  const service = new OrganizationsService(prisma, mail, notifications, env);
  return { service, prisma, mail, notifications };
}

describe("OrganizationsService", () => {
  describe("inviteByEmail", () => {
    it("requires an OWNER/ADMIN membership", async () => {
      const { service } = makeService();
      await expect(service.inviteByEmail("org-1", "member-1", "new@example.com", "MEMBER")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("refuses to invite someone who's already a member", async () => {
      const { service } = makeService({
        existingUser: { id: "member-1", email: "already@example.com" },
        memberships: { "member-1": MEMBER_MEMBERSHIP },
      });
      await expect(service.inviteByEmail("org-1", "owner-1", "already@example.com", "MEMBER")).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("sends a real email and creates a PENDING invite for a brand-new email", async () => {
      const { service, prisma, mail } = makeService();
      await service.inviteByEmail("org-1", "owner-1", "brandnew@example.com", "MEMBER");
      expect(prisma.client.organizationInvite.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: "org-1", email: "brandnew@example.com" }) }),
      );
      expect(mail.sendOrganizationInvite).toHaveBeenCalledWith(
        expect.objectContaining({ to: "brandnew@example.com", orgName: "Acme" }),
      );
    });

    it("also notifies in-app when the invited email already has an account", async () => {
      const { service, notifications } = makeService({
        existingUser: { id: "user-x", email: "hasaccount@example.com" },
      });
      await service.inviteByEmail("org-1", "owner-1", "hasaccount@example.com", "MEMBER");
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-x", type: "ORG_INVITE" }),
      );
    });

    it("refreshes an existing PENDING invite in place rather than erroring", async () => {
      const { service, prisma } = makeService();
      (prisma.client.organizationInvite.findFirst as jest.Mock).mockResolvedValue({ id: "invite-1", status: "PENDING" });
      await service.inviteByEmail("org-1", "owner-1", "again@example.com", "MEMBER");
      expect(prisma.client.organizationInvite.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "invite-1" } }),
      );
      expect(prisma.client.organizationInvite.create).not.toHaveBeenCalled();
    });
  });

  describe("acceptInvite", () => {
    const PENDING_INVITE = {
      id: "invite-1",
      orgId: "org-1",
      email: "invitee@example.com",
      role: "MEMBER" as const,
      status: "PENDING" as const,
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: "owner-1",
    };

    it("only accepts when the caller's own email matches the invite exactly", async () => {
      const { service, prisma } = makeService({ invite: PENDING_INVITE });
      (prisma.client.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({
        id: "user-x",
        email: "someone-else@example.com",
      });
      await expect(service.acceptInvite("tok", "user-x")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("creates a real membership when the email matches", async () => {
      const { service, prisma } = makeService({ invite: PENDING_INVITE });
      const result = await service.acceptInvite("tok", "user-x");
      expect(prisma.client.membership.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ orgId: "org-1", userId: "user-x", role: "MEMBER" }) }),
      );
      expect(prisma.client.organizationInvite.update).toHaveBeenCalledWith({
        where: { id: "invite-1" },
        data: { status: "ACCEPTED" },
      });
      expect(result).toBeTruthy();
    });

    it("refuses an already-accepted invite", async () => {
      const { service } = makeService({ invite: { ...PENDING_INVITE, status: "ACCEPTED" } });
      await expect(service.acceptInvite("tok", "user-x")).rejects.toBeInstanceOf(ConflictException);
    });

    it("refuses and expires an invite past its expiresAt", async () => {
      const { service, prisma } = makeService({ invite: { ...PENDING_INVITE, expiresAt: new Date(Date.now() - 1000) } });
      await expect(service.acceptInvite("tok", "user-x")).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.client.organizationInvite.update).toHaveBeenCalledWith({
        where: { id: "invite-1" },
        data: { status: "EXPIRED" },
      });
    });

    it("404s for an unknown token", async () => {
      const { service } = makeService({ invite: null });
      await expect(service.acceptInvite("bogus", "user-x")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("sole-owner protection", () => {
    it("removeMember refuses to remove the organization's only owner", async () => {
      const { service } = makeService({ ownerCount: 1 });
      await expect(service.removeMember("org-1", "owner-1", "owner-1")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("leaveOrg refuses when the caller is the sole owner", async () => {
      const { service } = makeService({ ownerCount: 1 });
      await expect(service.leaveOrg("org-1", "owner-1")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("removeMember allows removing an owner when another owner still exists", async () => {
      const { service, prisma } = makeService({ ownerCount: 2 });
      await service.removeMember("org-1", "owner-1", "owner-1");
      expect(prisma.client.membership.delete).toHaveBeenCalled();
    });

    it("updateMemberRole is OWNER-only, not ADMIN", async () => {
      const { service } = makeService();
      await expect(service.updateMemberRole("org-1", "admin-1", "member-1", "ADMIN")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("updateMemberRole refuses to demote the sole owner", async () => {
      const { service } = makeService({ ownerCount: 1 });
      await expect(service.updateMemberRole("org-1", "owner-1", "owner-1", "ADMIN")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe("per-org limits", () => {
    it("assertMeetingConcurrencyOk refuses once the org's LIVE meeting count reaches its limit", async () => {
      const { service, prisma } = makeService();
      (prisma.client.meeting.count as jest.Mock).mockResolvedValue(5); // ORG.meetingConcurrencyLimit
      await expect(service.assertMeetingConcurrencyOk("org-1")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("assertMeetingConcurrencyOk allows it under the limit", async () => {
      const { service, prisma } = makeService();
      (prisma.client.meeting.count as jest.Mock).mockResolvedValue(2);
      await expect(service.assertMeetingConcurrencyOk("org-1")).resolves.toBeUndefined();
    });

    it("assertStorageOk refuses an upload that would push the org over its storage limit", async () => {
      const { service, prisma } = makeService();
      (prisma.client.fileAsset.aggregate as jest.Mock).mockResolvedValue({ _sum: { sizeBytes: BigInt(999_000) } });
      await expect(service.assertStorageOk("org-1", 5_000)).rejects.toBeInstanceOf(ForbiddenException); // 999_000 + 5_000 > 1_000_000
    });

    it("assertStorageOk allows an upload comfortably under the limit", async () => {
      const { service, prisma } = makeService();
      (prisma.client.fileAsset.aggregate as jest.Mock).mockResolvedValue({ _sum: { sizeBytes: BigInt(100) } });
      await expect(service.assertStorageOk("org-1", 5_000)).resolves.toBeUndefined();
    });
  });

  describe("updateBranding", () => {
    it("requires an OWNER/ADMIN membership, same bar as addMember", async () => {
      const { service } = makeService();
      await expect(
        service.updateBranding("org-1", "member-1", { brandColor: "#3B6FE0" }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("an admin (not just an owner) can set branding", async () => {
      const { service, prisma } = makeService();
      await service.updateBranding("org-1", "admin-1", {
        logoUrl: "https://example.com/logo.png",
        brandColor: "#3B6FE0",
        joinPageMessage: "Welcome to Acme",
      });
      expect(prisma.client.organization.update).toHaveBeenCalledWith({
        where: { id: "org-1" },
        data: {
          logoUrl: "https://example.com/logo.png",
          brandColor: "#3B6FE0",
          joinPageMessage: "Welcome to Acme",
        },
      });
    });

    it("only writes the fields actually present in the DTO, leaving the rest untouched", async () => {
      const { service, prisma } = makeService();
      await service.updateBranding("org-1", "owner-1", { brandColor: "#000000" });
      expect(prisma.client.organization.update).toHaveBeenCalledWith({
        where: { id: "org-1" },
        data: { brandColor: "#000000" },
      });
    });

    it("a field explicitly set to null clears it", async () => {
      const { service, prisma } = makeService();
      await service.updateBranding("org-1", "owner-1", { logoUrl: null });
      expect(prisma.client.organization.update).toHaveBeenCalledWith({
        where: { id: "org-1" },
        data: { logoUrl: null },
      });
    });
  });
});
