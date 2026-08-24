import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { CreateAssignmentDto, UpdateAssignmentDto, SubmitAssignmentDto, GradeSubmissionDto } from "@arutech/validation";
import type { PresignUploadDto } from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { ClassesService } from "../classes/classes.service";
import { NotificationsService } from "../notifications/notifications.service";
import { isAllowedMimeType, sanitizeFileName } from "../files/file-upload.util";

/**
 * Classroom assignments — create, attach material, students submit (with
 * resubmission), teacher grades with score + feedback. Built on the
 * `Assignment`/`AssignmentSubmission` schema, files reuse the same
 * presigned-upload pattern as chat attachments (`apps/api/src/files`) but
 * scoped to a class instead of a meeting — see `file-upload.util.ts` for the
 * shared MIME allowlist both paths enforce.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly classes: ClassesService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(classId: string, teacherId: string, dto: CreateAssignmentDto) {
    await this.classes.requireTeacher(classId, teacherId);
    if (dto.fileId) await this.assertClassFile(classId, teacherId, dto.fileId);

    const assignment = await this.prisma.client.assignment.create({
      data: {
        classId,
        createdById: teacherId,
        title: dto.title,
        description: dto.description,
        fileId: dto.fileId,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
    });

    const students = await this.prisma.client.classStudent.findMany({
      where: { classId, status: "ACTIVE" },
      select: { userId: true },
    });
    for (const s of students) {
      await this.notifications.create({
        userId: s.userId,
        type: "ASSIGNMENT",
        title: "New assignment posted",
        body: dto.title,
        data: { classId, assignmentId: assignment.id },
      });
    }

    return assignment;
  }

  async update(classId: string, assignmentId: string, teacherId: string, dto: UpdateAssignmentDto) {
    await this.classes.requireTeacher(classId, teacherId);
    if (dto.fileId) await this.assertClassFile(classId, teacherId, dto.fileId);
    const assignment = await this.getOrThrow(classId, assignmentId);

    return this.prisma.client.assignment.update({
      where: { id: assignment.id },
      data: {
        title: dto.title,
        description: dto.description,
        fileId: dto.fileId,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
    });
  }

  async remove(classId: string, assignmentId: string, teacherId: string): Promise<void> {
    await this.classes.requireTeacher(classId, teacherId);
    const assignment = await this.getOrThrow(classId, assignmentId);
    await this.prisma.client.assignment.update({
      where: { id: assignment.id },
      data: { deletedAt: new Date() },
    });
  }

  async list(classId: string, userId: string) {
    await this.classes.requireMember(classId, userId);
    return this.prisma.client.assignment.findMany({
      where: { classId, deletedAt: null },
      include: { file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async getOne(classId: string, assignmentId: string, userId: string) {
    await this.classes.requireMember(classId, userId);
    const assignment = await this.getOrThrow(classId, assignmentId);
    return this.prisma.client.assignment.findUnique({
      where: { id: assignment.id },
      include: { file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } } },
    });
  }

  /** Creates (or overwrites, if one already exists — a resubmission) the
   * caller's own submission. Student-only: a teacher of the class isn't
   * enrolled as a student and can't submit their own assignment. */
  async submit(classId: string, assignmentId: string, studentId: string, dto: SubmitAssignmentDto) {
    await this.requireActiveStudent(classId, studentId);
    const assignment = await this.getOrThrow(classId, assignmentId);
    if (dto.fileId) await this.assertClassFile(classId, studentId, dto.fileId);

    const existing = await this.prisma.client.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId: assignment.id, studentId } },
    });

    const submission = existing
      ? await this.prisma.client.assignmentSubmission.update({
          where: { id: existing.id },
          data: {
            textContent: dto.textContent,
            fileId: dto.fileId,
            status: "RESUBMITTED",
            submittedAt: new Date(),
            // A resubmission invalidates whatever grade was given on the
            // previous version — the teacher needs to look at it again.
            score: null,
            feedback: null,
            gradedAt: null,
          },
        })
      : await this.prisma.client.assignmentSubmission.create({
          data: {
            assignmentId: assignment.id,
            studentId,
            textContent: dto.textContent,
            fileId: dto.fileId,
          },
        });

    const teachers = await this.prisma.client.classTeacher.findMany({
      where: { classId },
      select: { userId: true },
    });
    const student = await this.prisma.client.user.findUniqueOrThrow({ where: { id: studentId } });
    for (const t of teachers) {
      await this.notifications.create({
        userId: t.userId,
        type: "ASSIGNMENT",
        title: existing ? "Assignment resubmitted" : "New assignment submission",
        body: `${student.displayName} — ${assignment.title}`,
        data: { classId, assignmentId: assignment.id, studentId },
      });
    }

    return submission;
  }

  async getMySubmission(classId: string, assignmentId: string, studentId: string) {
    await this.classes.requireMember(classId, studentId);
    const assignment = await this.getOrThrow(classId, assignmentId);
    return this.prisma.client.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId: assignment.id, studentId } },
      include: { file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } } },
    });
  }

  async listSubmissions(classId: string, assignmentId: string, teacherId: string) {
    await this.classes.requireTeacher(classId, teacherId);
    const assignment = await this.getOrThrow(classId, assignmentId);
    return this.prisma.client.assignmentSubmission.findMany({
      where: { assignmentId: assignment.id },
      include: {
        student: { select: { id: true, displayName: true, avatarUrl: true } },
        file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
      },
      orderBy: { submittedAt: "desc" },
    });
  }

  async grade(classId: string, assignmentId: string, studentId: string, teacherId: string, dto: GradeSubmissionDto) {
    await this.classes.requireTeacher(classId, teacherId);
    const assignment = await this.getOrThrow(classId, assignmentId);
    const submission = await this.prisma.client.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId: assignment.id, studentId } },
    });
    if (!submission) throw new NotFoundException("No submission from this student yet");

    const graded = await this.prisma.client.assignmentSubmission.update({
      where: { id: submission.id },
      data: { score: dto.score, feedback: dto.feedback, status: "GRADED", gradedAt: new Date() },
    });

    await this.notifications.create({
      userId: studentId,
      type: "ASSIGNMENT",
      title: "Assignment graded",
      body: `${assignment.title} — ${dto.score} points`,
      data: { classId, assignmentId: assignment.id },
    });

    return graded;
  }

  /** Presigns an upload for either an assignment's own material (teacher) or
   * a student's submission — the same endpoint serves both, since the only
   * difference is which field (`Assignment.fileId` vs
   * `AssignmentSubmission.fileId`) ends up referencing the resulting file,
   * decided at create/submit time, not here. Any class member may call this;
   * `assertClassFile` is what actually enforces who may *reference* the
   * resulting fileId in an assignment or submission. */
  async presignAttachment(classId: string, callerUserId: string, dto: PresignUploadDto) {
    await this.classes.requireMember(classId, callerUserId);

    if (!isAllowedMimeType(dto.mimeType)) {
      throw new BadRequestException(`File type ${dto.mimeType} is not allowed`);
    }

    const safeName = sanitizeFileName(dto.fileName);
    const storageKey = `class-uploads/${classId}/${Date.now()}-${randomUUID()}-${safeName}`;

    const file = await this.prisma.client.fileAsset.create({
      data: {
        uploaderUserId: callerUserId,
        scope: "CLASS",
        classId,
        storageKey,
        originalName: safeName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        virusScanStatus: "PENDING",
      },
    });

    const uploadUrl = await this.storage.getSignedUploadUrl(storageKey, dto.mimeType);
    return { fileId: file.id, uploadUrl };
  }

  /** Permission-checked download: the caller must be a class member, and the
   * file must actually belong to this assignment (its own material) or to a
   * submission the caller is allowed to see (their own, or any submission if
   * the caller teaches the class). */
  async getAttachmentDownloadUrl(classId: string, assignmentId: string, callerUserId: string, fileId: string) {
    await this.classes.requireMember(classId, callerUserId);
    const assignment = await this.getOrThrow(classId, assignmentId);

    const isTeacher = await this.prisma.client.classTeacher
      .findUnique({ where: { classId_userId: { classId, userId: callerUserId } } })
      .then(Boolean);

    const file = await this.prisma.client.fileAsset.findUnique({ where: { id: fileId } });
    if (!file || file.classId !== classId) throw new NotFoundException("File not found");

    const isAssignmentMaterial = assignment.fileId === fileId;
    const ownSubmission = await this.prisma.client.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: callerUserId } },
    });
    const isOwnSubmission = ownSubmission?.fileId === fileId;
    const isAnySubmissionAndCallerTeaches =
      isTeacher &&
      (await this.prisma.client.assignmentSubmission
        .findFirst({ where: { assignmentId: assignment.id, fileId } })
        .then(Boolean));

    if (!isAssignmentMaterial && !isOwnSubmission && !isAnySubmissionAndCallerTeaches) {
      throw new ForbiddenException("You don't have access to this file");
    }
    if (file.virusScanStatus === "INFECTED") {
      throw new ForbiddenException("This file failed a virus scan and cannot be downloaded");
    }

    const url = await this.storage.getSignedDownloadUrl(file.storageKey);
    return { url, fileName: file.originalName, mimeType: file.mimeType, expiresInSeconds: 600 };
  }

  private async requireActiveStudent(classId: string, userId: string): Promise<void> {
    const student = await this.prisma.client.classStudent.findUnique({
      where: { classId_userId: { classId, userId } },
    });
    if (!student || student.status !== "ACTIVE") {
      throw new ForbiddenException("Only an enrolled student can submit an assignment");
    }
  }

  /** A fileId supplied on create/update/submit must actually be a `CLASS`
   * scoped file belonging to this class, uploaded by the caller — prevents
   * attaching someone else's file (or a file uploaded to a different class,
   * or a meeting-chat attachment) by guessing/reusing an id. */
  private async assertClassFile(classId: string, uploaderUserId: string, fileId: string): Promise<void> {
    const file = await this.prisma.client.fileAsset.findUnique({ where: { id: fileId } });
    if (!file || file.classId !== classId || file.uploaderUserId !== uploaderUserId) {
      throw new BadRequestException("Invalid attachment");
    }
  }

  private async getOrThrow(classId: string, assignmentId: string) {
    const assignment = await this.prisma.client.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment || assignment.classId !== classId || assignment.deletedAt) {
      throw new NotFoundException("Assignment not found");
    }
    return assignment;
  }
}
