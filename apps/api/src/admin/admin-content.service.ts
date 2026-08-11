import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Read-only listing queries backing the admin dashboard's Organizations, Meetings,
 * Classes, Recordings, and Audit Log sections. Deliberately just PrismaService —
 * there is no separate authorization concern here beyond SystemAdminGuard, which
 * every controller using this service already applies. */
@Injectable()
export class AdminContentService {
  constructor(private readonly prisma: PrismaService) {}

  async listOrganizations(take: number, skip: number) {
    const [organizations, total] = await Promise.all([
      this.prisma.client.organization.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          storageLimitBytes: true,
          createdAt: true,
          _count: { select: { memberships: true, meetings: true } },
        },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      this.prisma.client.organization.count({ where: { deletedAt: null } }),
    ]);
    return { organizations, total };
  }

  async listMeetings(take: number, skip: number, status?: string) {
    const where = { deletedAt: null, ...(status ? { status: status as never } : {}) };
    const [meetings, total] = await Promise.all([
      this.prisma.client.meeting.findMany({
        where,
        select: {
          id: true,
          code: true,
          title: true,
          type: true,
          status: true,
          ownerId: true,
          scheduledStart: true,
          actualStart: true,
          actualEnd: true,
          createdAt: true,
          _count: { select: { participants: true } },
        },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      this.prisma.client.meeting.count({ where }),
    ]);
    return { meetings, total };
  }

  async listClasses(take: number, skip: number) {
    const [classes, total] = await Promise.all([
      this.prisma.client.class.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          title: true,
          subject: true,
          ownerTeacherId: true,
          createdAt: true,
          _count: { select: { students: true, sessions: true } },
        },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      this.prisma.client.class.count({ where: { deletedAt: null } }),
    ]);
    return { classes, total };
  }

  async listRecordings(take: number, skip: number) {
    const [recordings, total] = await Promise.all([
      this.prisma.client.meetingRecording.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          meetingId: true,
          status: true,
          sizeBytes: true,
          durationSeconds: true,
          startedAt: true,
          expiresAt: true,
          meeting: { select: { title: true, code: true } },
        },
        orderBy: { startedAt: "desc" },
        take,
        skip,
      }),
      this.prisma.client.meetingRecording.count({ where: { deletedAt: null } }),
    ]);
    return { recordings, total };
  }

  async listAuditLogs(take: number, skip: number) {
    const [logs, total] = await Promise.all([
      this.prisma.client.auditLog.findMany({
        include: { actor: { select: { displayName: true, email: true } } },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      this.prisma.client.auditLog.count(),
    ]);
    return { logs, total };
  }
}
