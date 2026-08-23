import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { spawn } from "child_process";
import { mkdtemp, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { WS_EVENTS } from "@arutech/types";
import type { Prisma } from "@arutech/database";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { PermissionService } from "../meetings/permission.service";
import { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import { AuditLogService } from "../audit/audit-log.service";
import { NotificationsService } from "../notifications/notifications.service";
import { MetricsService } from "../observability/metrics.service";
import {
  TRANSCRIPTION_PROVIDER,
  type TranscriptionProvider,
  type TranscriptSegmentInput,
} from "./providers/transcription-provider.interface";
import { SUMMARIZATION_PROVIDER, type SummarizationProvider } from "./providers/summarization-provider.interface";
import { formatTranscriptText } from "./format-transcript-text";

// 15-minute chunks keep each mono/16kHz/64kbps mp3 chunk around ~7.2MB, safely
// under the Whisper API's 25MB-per-request limit regardless of how long the
// source recording is, without needing to inspect file size up front.
const CHUNK_SECONDS = 15 * 60;

/**
 * AI meeting assistant pipeline: recording -> audio extraction -> speech-to-text
 * -> LLM summary, per docs/roadmap.md Stage 8. Runs entirely against provider
 * INTERFACES (TranscriptionProvider / SummarizationProvider — see ./providers),
 * resolved by AiProviderModule from env vars, so no vendor is hardcoded here.
 *
 * **Known v1 simplification, stated honestly rather than hidden**: `process()`
 * runs in-process as a fire-and-forget task on whichever API instance received
 * the `generate()` request, the same way RecordingsService kicks off egress
 * synchronously but doesn't block on it. This is correct and non-blocking for a
 * single API instance. It is NOT yet safe/complete for horizontal API scaling —
 * if this instance crashes or restarts mid-pipeline, the transcript is stuck in
 * PROCESSING forever (no other replica picks it up), and there's no per-account
 * concurrency limit on how many transcriptions run at once. The documented
 * follow-up is a dedicated worker (services/workers, matching the recording
 * egress worker's own separate-process shape) claiming PENDING rows via a
 * `SELECT ... FOR UPDATE SKIP LOCKED`-style query or a real queue (BullMQ on the
 * existing Redis), which the TranscriptionProvider/SummarizationProvider
 * interfaces are already agnostic to (nothing about them assumes in-process).
 */
@Injectable()
export class TranscriptsService {
  private readonly logger = new Logger(TranscriptsService.name);
  /** In-process-only guard against double-processing (e.g. a retried request
   * landing while the first attempt is still running). See the class doc
   * comment above — this does not protect against multiple API instances. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly permissions: PermissionService,
    private readonly broadcast: RealtimeBroadcastService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationsService,
    private readonly metrics: MetricsService,
    @Inject(TRANSCRIPTION_PROVIDER) private readonly transcriptionProvider: TranscriptionProvider,
    @Inject(SUMMARIZATION_PROVIDER) private readonly summarizationProvider: SummarizationProvider,
  ) {}

  async generate(meetingId: string, callerUserId: string, recordingId?: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "transcript.generate");

    const recording = recordingId
      ? await this.prisma.client.meetingRecording.findUnique({ where: { id: recordingId } })
      : await this.prisma.client.meetingRecording.findFirst({
          where: { meetingId, status: "READY", deletedAt: null },
          orderBy: { startedAt: "desc" },
        });

    if (!recording || recording.meetingId !== meetingId) {
      throw new NotFoundException("No matching recording found for this meeting");
    }
    if (recording.status !== "READY" || !recording.storageKey) {
      throw new BadRequestException(
        "The recording must finish processing (status READY) before it can be transcribed",
      );
    }

    const existing = await this.prisma.client.meetingTranscript.findFirst({
      where: { recordingId: recording.id, status: { in: ["PENDING", "PROCESSING"] } },
    });
    if (existing) throw new BadRequestException("A transcript is already being generated for this recording");

    const transcript = await this.prisma.client.meetingTranscript.create({
      data: {
        meetingId,
        recordingId: recording.id,
        provider: this.summarizationProvider.name,
        status: "PENDING",
      },
    });

    // Fire-and-forget — see the class doc comment for why. The HTTP response
    // returns the PENDING row immediately; clients follow status transitions via
    // WS_EVENTS.TRANSCRIPT_UPDATED.
    void this.process(transcript.id, recording.storageKey).catch((err) =>
      this.logger.error(`Unhandled error processing transcript ${transcript.id}: ${String(err)}`),
    );

    return transcript;
  }

  async get(meetingId: string, callerUserId: string, transcriptId: string) {
    await this.permissions.getParticipant(meetingId, callerUserId);
    const transcript = await this.prisma.client.meetingTranscript.findUnique({
      where: { id: transcriptId },
      include: { segments: { orderBy: { startMs: "asc" } }, summary: true },
    });
    if (!transcript || transcript.meetingId !== meetingId) throw new NotFoundException("Transcript not found");
    return transcript;
  }

  async list(meetingId: string, callerUserId: string) {
    await this.permissions.getParticipant(meetingId, callerUserId);
    return this.prisma.client.meetingTranscript.findMany({
      where: { meetingId },
      include: { summary: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Full-text-ish search (ILIKE) over this meeting's transcript segments — see
   * docs/api.md. Deliberately simple (no ts_vector index) since transcript
   * volume per meeting is small; revisit with a GIN index if that changes. */
  async search(meetingId: string, callerUserId: string, query: string) {
    await this.permissions.getParticipant(meetingId, callerUserId);
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    return this.prisma.client.transcriptSegment.findMany({
      where: { transcript: { meetingId }, text: { contains: trimmed, mode: "insensitive" } },
      include: { transcript: { select: { id: true, meetingId: true } } },
      orderBy: { startMs: "asc" },
      take: 50,
    });
  }

  async remove(meetingId: string, callerUserId: string, transcriptId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "transcript.delete");
    const transcript = await this.prisma.client.meetingTranscript.findUnique({ where: { id: transcriptId } });
    if (!transcript || transcript.meetingId !== meetingId) throw new NotFoundException("Transcript not found");

    await this.prisma.client.meetingTranscript.delete({ where: { id: transcriptId } });
    await this.auditLog.record({
      actorUserId: callerUserId,
      action: "transcript.delete",
      targetType: "meeting_transcript",
      targetId: transcriptId,
      metadata: { meetingId },
    });
  }

  private async process(transcriptId: string, storageKey: string): Promise<void> {
    if (this.inFlight.has(transcriptId)) return;
    this.inFlight.add(transcriptId);
    const startedAt = Date.now();
    const workDir = await mkdtemp(join(tmpdir(), "arutech-transcript-"));

    try {
      const processing = await this.prisma.client.meetingTranscript.update({
        where: { id: transcriptId },
        data: { status: "PROCESSING" },
      });
      await this.broadcast.publish(processing.meetingId, WS_EVENTS.TRANSCRIPT_UPDATED, {
        transcriptId,
        status: "PROCESSING",
      });

      const sourcePath = join(workDir, "source.mp4");
      await this.storage.downloadToFile(storageKey, sourcePath);

      await this.extractAudioChunks(sourcePath, join(workDir, "chunk-%03d.mp3"));
      const chunkFiles = (await readdir(workDir)).filter((f) => f.startsWith("chunk-") && f.endsWith(".mp3")).sort();
      if (chunkFiles.length === 0) throw new Error("ffmpeg produced no audio chunks from the recording");

      const allSegments: TranscriptSegmentInput[] = [];
      let language = "en";
      for (const [i, chunkFile] of chunkFiles.entries()) {
        const offsetMs = i * CHUNK_SECONDS * 1000;
        const result = await this.transcriptionProvider.transcribe({ filePath: join(workDir, chunkFile) });
        if (result.language) language = result.language;
        for (const segment of result.segments) {
          allSegments.push({
            ...segment,
            startMs: segment.startMs + offsetMs,
            endMs: segment.endMs + offsetMs,
          });
        }
      }

      if (allSegments.length > 0) {
        await this.prisma.client.transcriptSegment.createMany({
          data: allSegments.map((s) => ({
            transcriptId,
            speakerLabel: s.speakerLabel,
            startMs: s.startMs,
            endMs: s.endMs,
            text: s.text,
          })),
        });
      }

      const transcriptText = formatTranscriptText(allSegments);

      const summaryResult = await this.summarizationProvider.summarize({
        transcriptText: transcriptText || "(No speech was detected in this recording.)",
        segments: allSegments,
      });

      await this.prisma.client.aiSummary.create({
        data: {
          transcriptId,
          summary: summaryResult.summary,
          keyPoints: summaryResult.keyPoints as unknown as Prisma.InputJsonValue,
          actionItems: summaryResult.actionItems as unknown as Prisma.InputJsonValue,
          decisions: summaryResult.decisions as unknown as Prisma.InputJsonValue,
          questions: summaryResult.questions as unknown as Prisma.InputJsonValue,
          chapters: summaryResult.chapters as unknown as Prisma.InputJsonValue,
          provider: this.summarizationProvider.name,
        },
      });

      const ready = await this.prisma.client.meetingTranscript.update({
        where: { id: transcriptId },
        data: { status: "READY", readyAt: new Date(), language },
      });

      this.metrics.transcriptionDurationSeconds.observe((Date.now() - startedAt) / 1000);
      await this.broadcast.publish(ready.meetingId, WS_EVENTS.TRANSCRIPT_UPDATED, {
        transcriptId,
        status: "READY",
      });

      if (ready.recordingId) {
        const recording = await this.prisma.client.meetingRecording.findUnique({
          where: { id: ready.recordingId },
        });
        if (recording) {
          await this.notifications.create({
            userId: recording.startedByUserId,
            type: "TRANSCRIPT_READY",
            title: "Meeting transcript ready",
            body: "The AI transcript and summary for your recording have finished processing.",
            data: { meetingId: ready.meetingId, transcriptId },
          });
        }
      }
    } catch (err) {
      this.logger.error(`Transcript ${transcriptId} failed: ${err instanceof Error ? err.stack : String(err)}`);
      this.metrics.transcriptionFailuresTotal.inc();
      const failed = await this.prisma.client.meetingTranscript.update({
        where: { id: transcriptId },
        data: { status: "FAILED" },
      });
      await this.broadcast.publish(failed.meetingId, WS_EVENTS.TRANSCRIPT_UPDATED, {
        transcriptId,
        status: "FAILED",
      });
    } finally {
      this.inFlight.delete(transcriptId);
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Shells out to ffmpeg (must be on PATH — installed in api.Dockerfile's
   * runtime stage; present by default in local dev on Linux/macOS with ffmpeg
   * installed) to strip video and split into fixed-length mono audio chunks in
   * one pass, using its `segment` muxer rather than a separate
   * probe-then-split step. */
  private extractAudioChunks(sourcePath: string, outputPattern: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        "-y",
        "-i",
        sourcePath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "64k",
        "-f",
        "segment",
        "-segment_time",
        String(CHUNK_SECONDS),
        "-reset_timestamps",
        "1",
        outputPattern,
      ];
      const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on("error", (err) => reject(new Error(`Failed to spawn ffmpeg: ${err.message}`)));
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
      });
    });
  }
}
