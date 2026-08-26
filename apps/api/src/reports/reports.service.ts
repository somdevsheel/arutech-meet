import { Injectable, NotFoundException } from "@nestjs/common";
import type { CreateReportDto } from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";
import { PermissionService } from "../meetings/permission.service";
import { AuditLogService } from "../audit/audit-log.service";

const REPORT_INCLUDE = {
  reporter: { select: { id: true, displayName: true, email: true } },
  reportedUser: { select: { id: true, displayName: true, email: true } },
  resolvedBy: { select: { id: true, displayName: true } },
  meeting: { select: { id: true, code: true, title: true } },
} as const;

/**
 * A complaint a real participant raises about someone else's behavior in a
 * meeting — distinct from AuditLog (which records actions a moderator/admin
 * actually TOOK, never complaints raised) and distinct from block (an
 * immediate, purely between-two-people action with no review step). A
 * report always lands in a real admin queue for a human to actually look at
 * — see the schema comment on `Report`.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Anyone who was genuinely a participant of this meeting at some point
   * (any status — including already REMOVED, since reporting the person who
   * got you removed is exactly a real use case) can file a report about it.
   * Reusing `PermissionService.getParticipant` for that check rather than
   * inventing a separate one. */
  async create(meetingId: string, reporterUserId: string, dto: CreateReportDto) {
    await this.permissions.getParticipant(meetingId, reporterUserId);
    return this.prisma.client.report.create({
      data: {
        meetingId,
        reporterUserId,
        reportedUserId: dto.reportedUserId,
        reportedGuestName: dto.reportedGuestName,
        reason: dto.reason,
        details: dto.details,
      },
    });
  }

  async listForAdmin(status: "OPEN" | "RESOLVED" | "DISMISSED" | undefined, take: number, skip: number) {
    const where = status ? { status } : {};
    const [reports, total] = await Promise.all([
      this.prisma.client.report.findMany({
        where,
        include: REPORT_INCLUDE,
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      this.prisma.client.report.count({ where }),
    ]);
    return { reports, total };
  }

  async resolve(
    reportId: string,
    adminUserId: string,
    dto: { status: "RESOLVED" | "DISMISSED"; resolutionNote?: string },
  ) {
    const report = await this.prisma.client.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException("Report not found");
    const updated = await this.prisma.client.report.update({
      where: { id: reportId },
      data: {
        status: dto.status,
        resolutionNote: dto.resolutionNote,
        resolvedByUserId: adminUserId,
        resolvedAt: new Date(),
      },
      include: REPORT_INCLUDE,
    });
    await this.auditLog.record({
      actorUserId: adminUserId,
      action: `report.${dto.status.toLowerCase()}`,
      targetType: "report",
      targetId: reportId,
      metadata: { meetingId: report.meetingId, reportedUserId: report.reportedUserId },
    });
    return updated;
  }
}
