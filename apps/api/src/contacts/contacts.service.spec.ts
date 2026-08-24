import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ContactsService } from "./contacts.service";
import type { PrismaService } from "../prisma/prisma.service";

const ME = "user-me";
const MET_A = { id: "user-a", displayName: "A", username: "a", email: "a@x.com", avatarUrl: null, lastSeenAt: new Date("2026-01-01T00:00:00Z") };
const MET_B = { id: "user-b", displayName: "B", username: "b", email: "b@x.com", avatarUrl: null, lastSeenAt: new Date("2026-01-01T00:00:00Z") };

function coParticipant(user: typeof MET_A, meetingId = "meeting-1") {
  return {
    meetingId,
    joinedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    user,
  };
}

function makeDeps(overrides?: {
  coParticipants?: unknown[];
  blocked?: unknown[];
  favorites?: unknown[];
  groupMemberships?: unknown[];
  group?: unknown;
  groupMember?: unknown;
}) {
  const prisma = {
    client: {
      meetingParticipant: {
        findMany: jest.fn().mockImplementation(({ where }: { where: { userId?: string } }) => {
          // First call (my own meetings) vs second call (co-participants) —
          // distinguish by whether `where.userId` equals ME.
          if (where.userId === ME) return Promise.resolve([{ meetingId: "meeting-1" }]);
          return Promise.resolve(overrides?.coParticipants ?? [coParticipant(MET_A)]);
        }),
      },
      blockedUser: {
        findMany: jest.fn().mockResolvedValue(overrides?.blocked ?? []),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      contactFavorite: {
        findMany: jest.fn().mockResolvedValue(overrides?.favorites ?? []),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      contactGroupMember: {
        findMany: jest.fn().mockResolvedValue(overrides?.groupMemberships ?? []),
        findUnique: jest.fn().mockResolvedValue(overrides?.groupMember ?? null),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      contactGroup: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "group-1", ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(
          overrides?.group === undefined ? { id: "group-1", ownerUserId: ME } : overrides.group,
        ),
        delete: jest.fn(),
      },
    },
  } as unknown as PrismaService;

  return { prisma };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new ContactsService(deps.prisma);
}

describe("ContactsService.list", () => {
  it("excludes a contact blocked in either direction", async () => {
    const deps = makeDeps({
      coParticipants: [coParticipant(MET_A), coParticipant(MET_B)],
      blocked: [{ blockerUserId: ME, blockedUserId: MET_A.id }],
    });
    const service = makeService(deps);

    const result = await service.list(ME);

    expect(result.map((c) => c.id)).toEqual([MET_B.id]);
  });

  it("also excludes a contact who blocked ME (the other direction)", async () => {
    const deps = makeDeps({
      coParticipants: [coParticipant(MET_A)],
      blocked: [{ blockerUserId: MET_A.id, blockedUserId: ME }],
    });
    const service = makeService(deps);

    const result = await service.list(ME);

    expect(result).toEqual([]);
  });

  it("marks favorites and sorts them first", async () => {
    const deps = makeDeps({
      coParticipants: [coParticipant(MET_A), coParticipant(MET_B)],
      favorites: [{ contactUserId: MET_B.id }],
    });
    const service = makeService(deps);

    const result = await service.list(ME);

    expect(result[0]).toMatchObject({ id: MET_B.id, isFavorite: true });
    expect(result[1]).toMatchObject({ id: MET_A.id, isFavorite: false });
  });
});

describe("ContactsService.block / isBlocked", () => {
  it("refuses to block yourself", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await expect(service.block(ME, ME)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("isBlocked is symmetric", async () => {
    const deps = makeDeps();
    (deps.prisma.client.blockedUser.findFirst as jest.Mock).mockResolvedValue({
      blockerUserId: MET_A.id,
      blockedUserId: ME,
    });
    const service = makeService(deps);
    await expect(service.isBlocked(ME, MET_A.id)).resolves.toBe(true);
  });
});

describe("ContactsService groups", () => {
  it("refuses to add a member to a group you don't own", async () => {
    const deps = makeDeps({ group: { id: "group-1", ownerUserId: "someone-else" } });
    const service = makeService(deps);
    await expect(service.addToGroup(ME, "group-1", MET_A.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("refuses adding the same contact twice", async () => {
    const deps = makeDeps({ groupMember: { id: "member-1" } });
    const service = makeService(deps);
    await expect(service.addToGroup(ME, "group-1", MET_A.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it("adds a new member to an owned group", async () => {
    const deps = makeDeps({ groupMember: null });
    const service = makeService(deps);
    await service.addToGroup(ME, "group-1", MET_A.id);
    expect(deps.prisma.client.contactGroupMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { groupId: "group-1", contactUserId: MET_A.id } }),
    );
  });
});
