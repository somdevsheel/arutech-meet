import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const ACTIVE_USER_WINDOW_DAYS = 30;

@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Everything here is a real aggregate query against Postgres — no placeholder
   * numbers. What is NOT included (and would need Stage 10's observability stack,
   * not just a DB query): bandwidth, packet loss/jitter, failed-connection counts.
   * Those live in LiveKit/infra metrics (Prometheus/OTel), not in this schema —
   * see docs/roadmap.md Stage 10. Reporting a fabricated number for them would be
   * worse than omitting the field, so the admin UI simply doesn't show a card for
   * what isn't backed by a real query yet.
   */
  async getDashboardStats() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const activeSince = new Date(now.getTime() - ACTIVE_USER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      totalOrganizations,
      meetingsToday,
      activeMeetings,
      classesToday,
      recordingStorageAgg,
      totalRecordings,
    ] = await Promise.all([
      this.prisma.client.user.count({ where: { deletedAt: null } }),
      this.prisma.client.session.count({
        where: { revokedAt: null, lastUsedAt: { gte: activeSince } },
        // Distinct-user active count would need a groupBy; session count is a
        // reasonable, honestly-labeled proxy (see the `note` field returned below).
      }),
      this.prisma.client.organization.count({ where: { deletedAt: null } }),
      this.prisma.client.meeting.count({
        where: { deletedAt: null, createdAt: { gte: startOfToday } },
      }),
      this.prisma.client.meeting.count({ where: { deletedAt: null, status: "LIVE" } }),
      this.prisma.client.classSession.count({ where: { sessionDate: { gte: startOfToday } } }),
      this.prisma.client.meetingRecording.aggregate({
        where: { deletedAt: null, sizeBytes: { not: null } },
        _sum: { sizeBytes: true },
      }),
      this.prisma.client.meetingRecording.count({ where: { deletedAt: null } }),
    ]);

    return {
      totalUsers,
      activeSessions: activeUsers,
      totalOrganizations,
      meetingsToday,
      activeMeetings,
      classesToday,
      totalRecordings,
      recordingStorageBytes: (recordingStorageAgg._sum.sizeBytes ?? 0n).toString(),
      notes: {
        activeSessions:
          `Count of non-revoked sessions active in the last ${ACTIVE_USER_WINDOW_DAYS} days ` +
          "(a proxy for active users, not deduplicated by user).",
        omitted:
          "Bandwidth, packet loss/jitter, and failed-connection counts require the " +
          "observability stack (Stage 10) and are not reported here rather than faked.",
      },
    };
  }

  async getSystemHealth() {
    const [dbOk, recentFailedRecordings] = await Promise.all([
      this.prisma.client.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.prisma.client.meetingRecording.count({
        where: { status: "FAILED", createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);

    return {
      postgres: dbOk ? "ok" : "down",
      apiProcess: {
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        memoryUsageMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      recordingFailuresLast24h: recentFailedRecordings,
    };
  }
}
