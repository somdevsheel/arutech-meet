import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditLogService } from "../audit/audit-log.service";

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
    const user = await this.prisma.client.user.update({
      where: { id: targetUserId },
      data: { status: "SUSPENDED" },
    }).catch(() => null);
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
    const user = await this.prisma.client.user.update({
      where: { id: targetUserId },
      data: { status: "ACTIVE" },
    }).catch(() => null);
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
