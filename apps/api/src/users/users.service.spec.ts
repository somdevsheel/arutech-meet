import { BadRequestException, NotFoundException } from "@nestjs/common";
import { UsersService } from "./users.service";
import type { PrismaService } from "../prisma/prisma.service";

function makePrismaMock() {
  return {
    client: {
      session: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    },
  } as unknown as PrismaService;
}

describe("UsersService.listSessions", () => {
  // L-1: nothing marked which listed session was "this device" — the
  // client needs that to decide which rows can show a revoke control.
  it("marks the caller's own current session and no others", async () => {
    const prisma = makePrismaMock();
    (prisma.client.session.findMany as jest.Mock).mockResolvedValue([
      { id: "session-current", userAgent: "Chrome", ip: "1.1.1.1", createdAt: new Date(), lastUsedAt: new Date() },
      { id: "session-other", userAgent: "Firefox", ip: "2.2.2.2", createdAt: new Date(), lastUsedAt: new Date() },
    ]);
    const service = new UsersService(prisma);

    const sessions = await service.listSessions("user-1", "session-current");

    expect(sessions.find((s) => s.id === "session-current")?.current).toBe(true);
    expect(sessions.find((s) => s.id === "session-other")?.current).toBe(false);
  });

  it("marks every session as not-current when the caller has no known session id (e.g. a guest)", async () => {
    const prisma = makePrismaMock();
    (prisma.client.session.findMany as jest.Mock).mockResolvedValue([
      { id: "session-a", userAgent: null, ip: null, createdAt: new Date(), lastUsedAt: new Date() },
    ]);
    const service = new UsersService(prisma);

    const sessions = await service.listSessions("user-1", undefined);

    expect(sessions.find((s) => s.id === "session-a")?.current).toBe(false);
  });
});

describe("UsersService.revokeSession", () => {
  // L-1: Active Sessions was purely read-only before this — this is the
  // actual fix, so it gets real coverage.
  it("refuses to revoke the caller's own current session", async () => {
    const prisma = makePrismaMock();
    const service = new UsersService(prisma);

    await expect(service.revokeSession("user-1", "session-current", "session-current")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.client.session.update).not.toHaveBeenCalled();
  });

  it("refuses to revoke a session that doesn't belong to the caller", async () => {
    const prisma = makePrismaMock();
    (prisma.client.session.findUnique as jest.Mock).mockResolvedValue({
      id: "session-other-user",
      userId: "someone-else",
    });
    const service = new UsersService(prisma);

    await expect(
      service.revokeSession("user-1", "session-other-user", "session-current"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.client.session.update).not.toHaveBeenCalled();
  });

  it("refuses to revoke a session that doesn't exist at all", async () => {
    const prisma = makePrismaMock();
    (prisma.client.session.findUnique as jest.Mock).mockResolvedValue(null);
    const service = new UsersService(prisma);

    await expect(service.revokeSession("user-1", "nonexistent", "session-current")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("revokes a real other session belonging to the caller", async () => {
    const prisma = makePrismaMock();
    (prisma.client.session.findUnique as jest.Mock).mockResolvedValue({
      id: "session-other",
      userId: "user-1",
    });
    const service = new UsersService(prisma);

    await service.revokeSession("user-1", "session-other", "session-current");

    expect(prisma.client.session.update).toHaveBeenCalledWith({
      where: { id: "session-other" },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
