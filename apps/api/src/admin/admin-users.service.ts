import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@arutech/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuditLogService } from "../audit/audit-log.service";

/** True only for Prisma's "record to update/delete not found" error (P2025)
 * — see the two catches below for why this distinction matters. */
function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(search: string | undefined, take: number, skip: number) {
    const where = search
      ? {
          deletedAt: null,
          OR: [
            { email: { contains: search, mode: "insensitive" as const } },
            { displayName: { contains: search, mode: "insensitive" as const } },
            { username: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : { deletedAt: null };

    const [users, total] = await Promise.all([
      this.prisma.client.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          displayName: true,
          username: true,
          systemRole: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      this.prisma.client.user.count({ where }),
    ]);

    return { users, total };
  }

  async suspend(adminUserId: string, targetUserId: string) {
    // Only a genuinely missing row should become "User not found" — a
    // blanket `.catch(() => null)` here used to swallow every possible
    // failure (a DB connection drop, a constraint violation, anything),
    // reporting each one as "User not found" with the real cause never
    // logged anywhere. Anything other than an actual missing-record error
    // rethrows as a real 500, visible for what it is.
    const user = await this.prisma.client.user
      .update({
        where: { id: targetUserId },
        data: { status: "SUSPENDED" },
      })
      .catch((err) => {
        if (isRecordNotFound(err)) return null;
        throw err;
      });
    if (!user) throw new NotFoundException("User not found");

    // Suspending an account should also cut off any sessions it already holds —
    // otherwise a suspended user keeps working until their access token expires.
    await this.prisma.client.session.updateMany({
      where: { userId: targetUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.auditLog.record({
      actorUserId: adminUserId,
      action: "admin.user.suspend",
      targetType: "user",
      targetId: targetUserId,
    });
    return user;
  }

  async activate(adminUserId: string, targetUserId: string) {
    // Same reasoning as suspend() above.
    const user = await this.prisma.client.user
      .update({
        where: { id: targetUserId },
        data: { status: "ACTIVE" },
      })
      .catch((err) => {
        if (isRecordNotFound(err)) return null;
        throw err;
      });
    if (!user) throw new NotFoundException("User not found");

    await this.auditLog.record({
      actorUserId: adminUserId,
      action: "admin.user.activate",
      targetType: "user",
      targetId: targetUserId,
    });
    return user;
  }
}
