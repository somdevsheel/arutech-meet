import { FeatureFlagsService } from "./feature-flags.service";
import type { PrismaService } from "../prisma/prisma.service";

function makeService(overrides?: { globalRow?: unknown; orgRow?: unknown }) {
  const findFirst = jest.fn().mockImplementation(({ where }: { where: { organizationId: string | null } }) => {
    if (where.organizationId === null) return Promise.resolve(overrides?.globalRow ?? null);
    return Promise.resolve(overrides?.orgRow ?? null);
  });
  const prisma = {
    client: {
      featureFlag: {
        findFirst,
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "flag-1", ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "flag-1", ...data })),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      meeting: { findUniqueOrThrow: jest.fn().mockResolvedValue({ orgId: "org-1" }) },
    },
  } as unknown as PrismaService;

  const service = new FeatureFlagsService(prisma);
  return { service, prisma };
}

describe("FeatureFlagsService", () => {
  describe("isEnabled", () => {
    it("defaults to enabled for a key that was never configured — never silently disables an existing feature", async () => {
      const { service } = makeService();
      expect(await service.isEnabled("SOME_UNCONFIGURED_KEY")).toBe(true);
    });

    it("uses the global row's value when one exists and no org is given", async () => {
      const { service } = makeService({ globalRow: { enabled: false } });
      expect(await service.isEnabled("WHITEBOARD")).toBe(false);
    });

    it("an org-scoped override takes precedence over the global row", async () => {
      const { service } = makeService({ globalRow: { enabled: false }, orgRow: { enabled: true } });
      expect(await service.isEnabled("WHITEBOARD", "org-1")).toBe(true);
    });

    it("falls back to the global row when no org override exists for that org", async () => {
      const { service } = makeService({ globalRow: { enabled: false } });
      expect(await service.isEnabled("WHITEBOARD", "org-1")).toBe(false);
    });
  });

  describe("isEnabledForMeeting", () => {
    it("resolves the org from the meeting before checking", async () => {
      const { service, prisma } = makeService({ orgRow: { enabled: false } });
      const result = await service.isEnabledForMeeting("WHITEBOARD", "meeting-1");
      expect(prisma.client.meeting.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "meeting-1" },
        select: { orgId: true },
      });
      expect(result).toBe(false);
    });
  });

  describe("setGlobal / setOrgOverride", () => {
    it("creates a new row when none exists yet, and updates in place on a second call", async () => {
      const { service, prisma } = makeService();
      await service.setGlobal("WHITEBOARD", false, "test");
      expect(prisma.client.featureFlag.create).toHaveBeenCalledWith({
        data: { key: "WHITEBOARD", organizationId: null, enabled: false, description: "test" },
      });

      const { service: service2, prisma: prisma2 } = makeService({ globalRow: { id: "flag-1", enabled: false } });
      await service2.setGlobal("WHITEBOARD", true);
      expect(prisma2.client.featureFlag.update).toHaveBeenCalledWith({
        where: { id: "flag-1" },
        data: { enabled: true, description: undefined },
      });
      expect(prisma2.client.featureFlag.create).not.toHaveBeenCalled();
    });

    it("removeOrgOverride deletes only that org's override row", async () => {
      const { service, prisma } = makeService();
      await service.removeOrgOverride("WHITEBOARD", "org-1");
      expect(prisma.client.featureFlag.deleteMany).toHaveBeenCalledWith({
        where: { key: "WHITEBOARD", organizationId: "org-1" },
      });
    });
  });
});
