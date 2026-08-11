import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

/**
 * Recording expiration architecture (spec §17): recordings carry an `expiresAt`
 * set at creation (see RecordingsService.start, RETENTION_DAYS) and this job
 * sweeps past-expiry recordings daily, deleting the S3 object and marking the row
 * DELETED — the same effect as a manual delete, just time-triggered.
 */
@Injectable()
export class RecordingsCleanupService {
  private readonly logger = new Logger(RecordingsCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async sweepExpiredRecordings(): Promise<void> {
    const expired = await this.prisma.client.meetingRecording.findMany({
      where: { status: "READY", deletedAt: null, expiresAt: { lt: new Date() } },
    });

    for (const recording of expired) {
      try {
        if (recording.storageKey) await this.storage.deleteObject(recording.storageKey);
        await this.prisma.client.meetingRecording.update({
          where: { id: recording.id },
          data: { status: "DELETED", deletedAt: new Date() },
        });
        this.logger.log(`Expired recording ${recording.id} deleted (past retention window)`);
      } catch (err) {
        this.logger.error(`Failed to expire recording ${recording.id}: ${String(err)}`);
      }
    }
  }
}
