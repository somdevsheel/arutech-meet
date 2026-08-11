import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { MetricsService } from "./metrics.service";

/** Keeps gauges that aren't naturally updated by an event (unlike, say,
 * websocketConnections, which increments/decrements right where connections
 * happen) in sync via periodic polling instead. */
@Injectable()
export class MetricsUpdaterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async refresh() {
    const activeMeetings = await this.prisma.client.meeting.count({
      where: { deletedAt: null, status: "LIVE" },
    });
    this.metrics.activeMeetings.set(activeMeetings);
  }
}
