import { NotFoundException } from "@nestjs/common";
import { ReportsService } from "./reports.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { PermissionService } from "../meetings/permission.service";
import type { AuditLogService } from "../audit/audit-log.service";

const REPORT = {
  id: "report-1",
  meetingId: "meeting-1",
  reportedUserId: "target-1",
  status: "OPEN" as const,
};

function makeService(overrides?: { participant?: unknown; report?: unknown }) {
  const prisma = {
    client: {
      report: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "report-1", status: "OPEN", ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(overrides && "report" in overrides ? overrides.report : REPORT),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...REPORT, ...data })),
      },
    },
  } as unknown as PrismaService;
  const permissions = {
    getParticipant: overrides?.participant === null
      ? jest.fn().mockRejectedValue(new NotFoundException("You are not a participant of this meeting"))
      : jest.fn().mockResolvedValue(overrides?.participant ?? { id: "participant-1", userId: "reporter-1" }),
  } as unknown as PermissionService;
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService;

  const service = new ReportsService(prisma, permissions, auditLog);
  return { service, prisma, permissions, auditLog };
}

describe("ReportsService", () => {
  describe("create", () => {
    it("requires the reporter to have actually been a participant of this meeting", async () => {
      const { service, permissions } = makeService();
      await service.create("meeting-1", "reporter-1", { reportedUserId: "target-1", reason: "SPAM" } as never);
      expect(permissions.getParticipant).toHaveBeenCalledWith("meeting-1", "reporter-1");
    });

    it("refuses someone who was never a participant of that meeting", async () => {
      const { service } = makeService({ participant: null });
      await expect(
        service.create("meeting-1", "outsider-1", { reportedUserId: "target-1", reason: "SPAM" } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("creates a real OPEN report row with the given reason/details", async () => {
      const { service, prisma } = makeService();
      await service.create("meeting-1", "reporter-1", {
        reportedUserId: "target-1",
        reason: "HARASSMENT",
        details: "kept interrupting everyone",
      } as never);
      expect(prisma.client.report.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            meetingId: "meeting-1",
            reporterUserId: "reporter-1",
            reportedUserId: "target-1",
            reason: "HARASSMENT",
            details: "kept interrupting everyone",
          }),
        }),
      );
    });
  });

  describe("listForAdmin", () => {
    it("filters by status when given one", async () => {
      const { service, prisma } = makeService();
      await service.listForAdmin("OPEN", 50, 0);
      expect(prisma.client.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: "OPEN" } }),
      );
    });

    it("returns every report when no status filter is given", async () => {
      const { service, prisma } = makeService();
      await service.listForAdmin(undefined, 50, 0);
      expect(prisma.client.report.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });
  });

  describe("resolve", () => {
    it("404s for an unknown report", async () => {
      const { service } = makeService({ report: null });
      await expect(service.resolve("bogus", "admin-1", { status: "DISMISSED" })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("stamps who resolved it and when, and records a real audit-log action distinguishing resolve from dismiss", async () => {
      const { service, prisma, auditLog } = makeService();
      await service.resolve("report-1", "admin-1", { status: "RESOLVED", resolutionNote: "warned the user" });
      expect(prisma.client.report.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "report-1" },
          data: expect.objectContaining({
            status: "RESOLVED",
            resolutionNote: "warned the user",
            resolvedByUserId: "admin-1",
          }),
        }),
      );
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: "report.resolved" }));
    });

    it("dismiss produces its own distinct audit action, not a generic one", async () => {
      const { service, auditLog } = makeService();
      await service.resolve("report-1", "admin-1", { status: "DISMISSED" });
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: "report.dismissed" }));
    });
  });
});
