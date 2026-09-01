import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@arutech/database";
import { AdminUsersService } from "./admin-users.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditLogService } from "../audit/audit-log.service";

const TARGET_USER = { id: "target-1", email: "target@arutech.dev", status: "ACTIVE" };

function notFoundError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "An operation failed because it depends on one or more records that were required but not found.",
    { code: "P2025", clientVersion: "5.22.0" },
  );
}

function makeDeps(overrides?: { updateError?: unknown }) {
  const prisma = {
    client: {
      user: {
        update: overrides?.updateError
          ? jest.fn().mockRejectedValue(overrides.updateError)
          : jest
              .fn()
              .mockImplementation(({ data }) => Promise.resolve({ ...TARGET_USER, ...data })),
      },
      session: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    },
  } as unknown as PrismaService;

  const auditLog = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService;

  return { prisma, auditLog };
}

describe("AdminUsersService.suspend / activate — failure reporting", () => {
  // The actual bug: `.catch(() => null)` around the update call used to
  // swallow EVERY possible failure — a missing row, a DB connection drop, a
  // constraint violation, anything — and report all of them identically as
  // "User not found", with the real cause never surfacing anywhere.

  it("suspend() reports a genuinely missing user as NotFoundException (P2025)", async () => {
    const { prisma, auditLog } = makeDeps({ updateError: notFoundError() });
    const service = new AdminUsersService(prisma, auditLog);
    await expect(service.suspend("admin-1", "missing-user")).rejects.toThrow(NotFoundException);
  });

  it("activate() reports a genuinely missing user as NotFoundException (P2025)", async () => {
    const { prisma, auditLog } = makeDeps({ updateError: notFoundError() });
    const service = new AdminUsersService(prisma, auditLog);
    await expect(service.activate("admin-1", "missing-user")).rejects.toThrow(NotFoundException);
  });

  it("suspend() does NOT report an unrelated DB failure as 'User not found' — it propagates the real error", async () => {
    const dbError = new Error("Connection terminated unexpectedly");
    const { prisma, auditLog } = makeDeps({ updateError: dbError });
    const service = new AdminUsersService(prisma, auditLog);
    await expect(service.suspend("admin-1", TARGET_USER.id)).rejects.toThrow(
      "Connection terminated unexpectedly",
    );
    await expect(service.suspend("admin-1", TARGET_USER.id)).rejects.not.toThrow(NotFoundException);
  });

  it("activate() does NOT report an unrelated DB failure as 'User not found' — it propagates the real error", async () => {
    const dbError = new Error("Connection terminated unexpectedly");
    const { prisma, auditLog } = makeDeps({ updateError: dbError });
    const service = new AdminUsersService(prisma, auditLog);
    await expect(service.activate("admin-1", TARGET_USER.id)).rejects.toThrow(
      "Connection terminated unexpectedly",
    );
    await expect(service.activate("admin-1", TARGET_USER.id)).rejects.not.toThrow(
      NotFoundException,
    );
  });

  it("suspend() still succeeds, revokes sessions, and audit-logs on a genuine update", async () => {
    const { prisma, auditLog } = makeDeps();
    const service = new AdminUsersService(prisma, auditLog);
    const result = await service.suspend("admin-1", TARGET_USER.id);
    expect(result.status).toBe("SUSPENDED");
    expect(prisma.client.session.updateMany).toHaveBeenCalledWith({
      where: { userId: TARGET_USER.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.user.suspend", targetId: TARGET_USER.id }),
    );
  });

  it("activate() still succeeds and audit-logs on a genuine update", async () => {
    const { prisma, auditLog } = makeDeps();
    const service = new AdminUsersService(prisma, auditLog);
    const result = await service.activate("admin-1", TARGET_USER.id);
    expect(result.status).toBe("ACTIVE");
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.user.activate", targetId: TARGET_USER.id }),
    );
  });
});
