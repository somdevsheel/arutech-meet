import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@arutech/database";
import type { GenerateStudyMaterialDto } from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";
import { ClassesService } from "../classes/classes.service";
import { NotificationsService } from "../notifications/notifications.service";
import { SUMMARIZATION_PROVIDER, type SummarizationProvider } from "./providers/summarization-provider.interface";
import { formatTranscriptText } from "./format-transcript-text";

/**
 * AI classroom assistant: lecture notes/flashcards/practice questions/study
 * guide generated from a class session's already-existing transcript — reuses
 * the Stage 8 AI-meeting-assistant pipeline's `SummarizationProvider`
 * (`generateStudyMaterial`, a different prompt + JSON schema on the same
 * interface `TranscriptsService` already depends on) rather than a second AI
 * pipeline. A single chat-completion call, unlike transcription's multi-step
 * audio pipeline, so this runs synchronously in the request rather than
 * adopting TranscriptsService's fire-and-forget PENDING/PROCESSING pattern —
 * documented as the simpler choice for now, not an oversight; worth
 * revisiting if generation latency in practice makes that a bad trade.
 *
 * Ships DRAFT — the brief's own requirement that a teacher review generated
 * content before students ever see it, enforced here, not just in the UI:
 * `list`/`getOne` filter DRAFT rows out entirely for non-teachers.
 */
@Injectable()
export class StudyMaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classes: ClassesService,
    private readonly notifications: NotificationsService,
    @Inject(SUMMARIZATION_PROVIDER) private readonly summarizationProvider: SummarizationProvider,
  ) {}

  /** Every READY transcript from one of this class's sessions — what a
   * teacher picks from before generating. Teacher-only: a transcript is
   * meeting-scoped raw material, not classroom content in its own right. */
  async listEligibleTranscripts(classId: string, teacherId: string) {
    await this.classes.requireTeacher(classId, teacherId);
    const sessions = await this.prisma.client.classSession.findMany({
      where: { classId },
      select: { id: true, title: true, sessionDate: true, meetingId: true },
    });
    const meetingIds = sessions.map((s) => s.meetingId);
    if (meetingIds.length === 0) return [];

    const transcripts = await this.prisma.client.meetingTranscript.findMany({
      where: { meetingId: { in: meetingIds }, status: "READY" },
      orderBy: { readyAt: "desc" },
    });
    const sessionByMeetingId = new Map(sessions.map((s) => [s.meetingId, s]));
    return transcripts.map((t) => ({
      transcriptId: t.id,
      session: sessionByMeetingId.get(t.meetingId) ?? null,
      readyAt: t.readyAt,
    }));
  }

  async generate(classId: string, teacherId: string, dto: GenerateStudyMaterialDto) {
    await this.classes.requireTeacher(classId, teacherId);

    const transcript = await this.prisma.client.meetingTranscript.findUnique({
      where: { id: dto.transcriptId },
      include: { segments: { orderBy: { startMs: "asc" } } },
    });
    if (!transcript) throw new NotFoundException("Transcript not found");
    if (transcript.status !== "READY") {
      throw new BadRequestException("The transcript must be READY before generating study material from it");
    }

    // The transcript must actually belong to one of THIS class's sessions —
    // without this, a teacher could generate study material scoped to this
    // class from a transcript for a completely unrelated meeting by guessing
    // its id.
    const session = await this.prisma.client.classSession.findFirst({
      where: { classId, meetingId: transcript.meetingId },
    });
    if (!session) throw new BadRequestException("That transcript doesn't belong to a session of this class");

    const segments = transcript.segments.map((s) => ({
      startMs: s.startMs,
      endMs: s.endMs,
      text: s.text,
      speakerLabel: s.speakerLabel ?? undefined,
    }));
    const result = await this.summarizationProvider.generateStudyMaterial({
      transcriptText: formatTranscriptText(transcript.segments) || "(No speech was detected in this session.)",
      segments,
    });

    return this.prisma.client.classroomStudyMaterial.create({
      data: {
        classId,
        transcriptId: transcript.id,
        createdByUserId: teacherId,
        status: "DRAFT",
        title: result.title,
        lectureNotes: result.lectureNotes,
        studyGuide: result.studyGuide,
        flashcards: result.flashcards as unknown as Prisma.InputJsonValue,
        practiceQuestions: result.practiceQuestions as unknown as Prisma.InputJsonValue,
        provider: this.summarizationProvider.name,
      },
    });
  }

  async list(classId: string, userId: string) {
    await this.classes.requireMember(classId, userId);
    const isTeacher = await this.classes.isTeacher(classId, userId);
    return this.prisma.client.classroomStudyMaterial.findMany({
      where: { classId, ...(isTeacher ? {} : { status: "PUBLISHED" }) },
      select: {
        id: true,
        status: true,
        title: true,
        createdAt: true,
        publishedAt: true,
        transcriptId: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getOne(classId: string, materialId: string, userId: string) {
    await this.classes.requireMember(classId, userId);
    const material = await this.getOrThrow(classId, materialId);
    if (material.status !== "PUBLISHED" && !(await this.classes.isTeacher(classId, userId))) {
      // A student has no legitimate reason to know an unpublished draft
      // exists at all — 404, not 403, matches how this codebase treats other
      // not-yet-visible resources (e.g. AssignmentsService).
      throw new NotFoundException("Study material not found");
    }
    return material;
  }

  async publish(classId: string, materialId: string, teacherId: string) {
    await this.classes.requireTeacher(classId, teacherId);
    const material = await this.getOrThrow(classId, materialId);
    if (material.status === "PUBLISHED") return material;

    const published = await this.prisma.client.classroomStudyMaterial.update({
      where: { id: material.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    const students = await this.prisma.client.classStudent.findMany({
      where: { classId, status: "ACTIVE" },
      select: { userId: true },
    });
    for (const s of students) {
      await this.notifications.create({
        userId: s.userId,
        type: "STUDY_MATERIAL",
        title: "New study material posted",
        body: published.title,
        data: { classId, studyMaterialId: published.id },
      });
    }

    return published;
  }

  async remove(classId: string, materialId: string, teacherId: string): Promise<void> {
    await this.classes.requireTeacher(classId, teacherId);
    const material = await this.getOrThrow(classId, materialId);
    await this.prisma.client.classroomStudyMaterial.delete({ where: { id: material.id } });
  }

  private async getOrThrow(classId: string, materialId: string) {
    const material = await this.prisma.client.classroomStudyMaterial.findUnique({ where: { id: materialId } });
    if (!material || material.classId !== classId) throw new NotFoundException("Study material not found");
    return material;
  }
}
