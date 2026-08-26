import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { TeamsService } from "./teams.service";
import type { PrismaService } from "../prisma/prisma.service";

const TEAM = { id: "team-1", orgId: "org-1", deletedAt: null, chatRoom: { id: "room-1" } };
const LEAD_MEMBERSHIP = { teamId: "team-1", userId: "lead-1", role: "LEAD" as const };
const REGULAR_MEMBERSHIP = { teamId: "team-1", userId: "member-1", role: "MEMBER" as const };

function makeService(overrides?: {
  orgMembership?: unknown;
  teamMembers?: Record<string, unknown>;
  leadCount?: number;
}) {
  const teamMembersByUser: Record<string, unknown> = {
    "lead-1": LEAD_MEMBERSHIP,
    "member-1": REGULAR_MEMBERSHIP,
    ...overrides?.teamMembers,
  };

  const prisma = {
    client: {
      membership: {
        findUnique: jest.fn().mockResolvedValue(
          overrides?.orgMembership !== undefined ? overrides.orgMembership : { orgId: "org-1", userId: "any", role: "MEMBER" },
        ),
      },
      team: {
        findUnique: jest.fn().mockResolvedValue(TEAM),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "team-1", ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "team-1", ...data })),
      },
      teamMember: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { teamId_userId: { userId: string } } }) =>
          Promise.resolve(teamMembersByUser[where.teamId_userId.userId] ?? null),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "tm-1", ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "tm-1", ...data })),
        delete: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(overrides?.leadCount ?? 1),
      },
      chatMember: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    },
  } as unknown as PrismaService;

  const service = new TeamsService(prisma);
  return { service, prisma };
}

describe("TeamsService", () => {
  describe("create", () => {
    it("requires org membership", async () => {
      const { service } = makeService({ orgMembership: null });
      await expect(service.create("org-1", "user-1", { name: "Engineering" })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("creates the team, its chat room, and makes the creator LEAD in one go", async () => {
      const { service, prisma } = makeService();
      await service.create("org-1", "user-1", { name: "Engineering" });
      expect(prisma.client.team.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orgId: "org-1",
            name: "Engineering",
            members: { create: { userId: "user-1", role: "LEAD" } },
            chatRoom: expect.objectContaining({
              create: expect.objectContaining({ type: "TEAM" }),
            }),
          }),
        }),
      );
    });
  });

  describe("join / leave", () => {
    it("join() refuses a non-org-member", async () => {
      const { service } = makeService({ orgMembership: null });
      await expect(service.join("team-1", "user-1")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("join() refuses someone who's already a member", async () => {
      const { service } = makeService({ teamMembers: { "user-1": REGULAR_MEMBERSHIP } });
      await expect(service.join("team-1", "user-1")).rejects.toBeInstanceOf(ConflictException);
    });

    it("join() creates both a TeamMember and a ChatMember together", async () => {
      const { service, prisma } = makeService({ teamMembers: { "user-1": null } });
      await service.join("team-1", "user-1");
      expect(prisma.client.$transaction).toHaveBeenCalled();
    });

    it("leave() refuses when the caller is the team's only lead", async () => {
      const { service } = makeService({ leadCount: 1 });
      await expect(service.leave("team-1", "lead-1")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("leave() allows a regular member to leave freely", async () => {
      const { service, prisma } = makeService();
      await service.leave("team-1", "member-1");
      expect(prisma.client.$transaction).toHaveBeenCalled();
    });

    it("leave() allows leaving as a lead when another lead still exists", async () => {
      const { service, prisma } = makeService({ leadCount: 2 });
      await service.leave("team-1", "lead-1");
      expect(prisma.client.$transaction).toHaveBeenCalled();
    });
  });

  describe("member management", () => {
    it("removeMember requires LEAD", async () => {
      const { service } = makeService();
      await expect(service.removeMember("team-1", "member-1", "lead-1")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("removeMember refuses to remove the team's only lead", async () => {
      const { service } = makeService({ leadCount: 1 });
      await expect(service.removeMember("team-1", "lead-1", "lead-1")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("updateMemberRole requires LEAD", async () => {
      const { service } = makeService();
      await expect(service.updateMemberRole("team-1", "member-1", "member-1", "LEAD")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("updateMemberRole refuses to demote the team's only lead", async () => {
      const { service } = makeService({ leadCount: 1 });
      await expect(service.updateMemberRole("team-1", "lead-1", "lead-1", "MEMBER")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("updateMemberRole 404s for a non-member target", async () => {
      const { service } = makeService({ teamMembers: { "ghost-1": null } });
      await expect(service.updateMemberRole("team-1", "lead-1", "ghost-1", "LEAD")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("update / delete", () => {
    it("update requires LEAD", async () => {
      const { service } = makeService();
      await expect(service.update("team-1", "member-1", { name: "New name" })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("delete requires LEAD", async () => {
      const { service } = makeService();
      await expect(service.delete("team-1", "member-1")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("delete soft-deletes rather than removing the row", async () => {
      const { service, prisma } = makeService();
      await service.delete("team-1", "lead-1");
      expect(prisma.client.team.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "team-1" }, data: { deletedAt: expect.any(Date) } }),
      );
    });
  });
});
