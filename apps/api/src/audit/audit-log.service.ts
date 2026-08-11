import { Injectable } from "@nestjs/common";
import type { Prisma } from "@arutech/database";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditLogEntry {
  actorUserId?: string;
  orgId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * The single writer for `audit_logs`. Previously-empty table with no code
 * writing to it in earlier stages — wired here into the handful of actions that
 * actually matter for a security audit trail (participant removal, role
 * promotion, recording deletion, admin account actions) rather than every
 * request, which would just be noise. Add a call here when adding a new
 * privileged action, not a parallel logging mechanism.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditLogEntry): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        actorUserId: entry.actorUserId,
        orgId: entry.orgId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        ip: entry.ip,
        userAgent: entry.userAgent,
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
