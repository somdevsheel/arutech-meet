import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AddTeacherDto,
  CreateClassDto,
  CreateClassSessionDto,
  EnrollStudentDto,
  UpdateClassDto,
} from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";
import { generateLiveKitRoomName, generateMeetingCode } from "../common/lib/meeting-code";
import { CoursesService } from "../courses/courses.service";

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: CoursesService,
  ) {}

  async create(userId: string, dto: CreateClassDto) {
    if (dto.orgId) {
      const membership = await this.prisma.client.membership.findUnique({
        where: { orgId_userId: { orgId: dto.orgId, userId } },
      });
      if (!membership) throw new ForbiddenException("You are not a member of that organization");
    }
    if (dto.courseId) await this.courses.assertOwnedCourse(dto.courseId, userId);

    return this.prisma.client.class.create({
      data: {
        title: dto.title,
        description: dto.description,
        subject: dto.subject,
        orgId: dto.orgId,
        courseId: dto.courseId,
        ownerTeacherId: userId,
        teachers: { create: { userId } },
        chatRoom: { create: { type: "CLASS" } },
      },
      include: { teachers: true, students: true },
    });
  }

  /** Unlike every other handler in this service, this one used to take no
   * userId at all and returned the full teacher+student roster (names,
   * avatars) to anyone who could guess or enumerate a class UUID — the only
   * unauthenticated-in-practice read in the whole controller. Now requires
   * the same membership `listSessions` already did — checked in-memory
   * against the roster already fetched below rather than a second DB round
   * trip via `requireMember`, and after the existence check (not before),
   * so a genuinely missing class still 404s instead of reporting a
   * confusing "not a member" for something that was never there. */
  async findById(classId: string, userId: string) {
    const klass = await this.prisma.client.class.findUnique({
      where: { id: classId },
      include: {
        teachers: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } },
        students: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } },
        course: { select: { id: true, title: true } },
      },
    });
    if (!klass || klass.deletedAt) throw new NotFoundException("Class not found");
    const isMember =
      klass.teachers.some((t) => t.userId === userId) || klass.students.some((s) => s.userId === userId);
    if (!isMember) throw new ForbiddenException("Not a member of this class");
    return klass;
  }

  async listMine(userId: string) {
    return this.prisma.client.class.findMany({
      where: {
        deletedAt: null,
        OR: [{ teachers: { some: { userId } } }, { students: { some: { userId } } }],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(classId: string, userId: string, dto: UpdateClassDto) {
    await this.requireTeacher(classId, userId);
    if (dto.courseId) await this.courses.assertOwnedCourse(dto.courseId, userId);
    return this.prisma.client.class.update({
      where: { id: classId },
      data: dto,
    });
  }

  async addTeacher(classId: string, callerUserId: string, dto: AddTeacherDto) {
    await this.requireTeacher(classId, callerUserId);
    const existing = await this.prisma.client.classTeacher.findUnique({
      where: { classId_userId: { classId, userId: dto.userId } },
    });
    if (existing) throw new ConflictException("Already a teacher of this class");
    return this.prisma.client.classTeacher.create({ data: { classId, userId: dto.userId } });
  }

  async enrollStudent(classId: string, callerUserId: string, dto: EnrollStudentDto) {
    await this.requireTeacher(classId, callerUserId);
    const existing = await this.prisma.client.classStudent.findUnique({
      where: { classId_userId: { classId, userId: dto.userId } },
    });
    if (existing) {
      if (existing.status === "ACTIVE") throw new ConflictException("Already enrolled");
      return this.prisma.client.classStudent.update({
        where: { id: existing.id },
        data: { status: "ACTIVE" },
      });
    }
    return this.prisma.client.classStudent.create({ data: { classId, userId: dto.userId } });
  }

  async removeStudent(classId: string, callerUserId: string, studentUserId: string) {
    await this.requireTeacher(classId, callerUserId);
    await this.prisma.client.classStudent.updateMany({
      where: { classId, userId: studentUserId },
      data: { status: "REMOVED" },
    });
  }

  /** Creates a new class session — a scheduled/instant meeting owned by the caller,
   * type CLASS, linked 1:1 via class_sessions so it reuses the entire meeting
   * engine (join flow, LiveKit tokens, chat, waiting room) rather than a parallel
   * implementation. Role resolution (TEACHER/STUDENT) happens in
   * MeetingsService.join() by looking up this link. */
  async createSession(classId: string, callerUserId: string, dto: CreateClassSessionDto) {
    await this.requireTeacher(classId, callerUserId);
    const klass = await this.findById(classId, callerUserId);

    const code = generateMeetingCode();
    const meeting = await this.prisma.client.meeting.create({
      data: {
        code,
        title: dto.title ?? klass.title,
        type: "CLASS",
        status: "SCHEDULED",
        ownerId: callerUserId,
        orgId: klass.orgId,
        livekitRoomName: generateLiveKitRoomName(code),
        settings: {
          create: {
            waitingRoomEnabled: dto.settings?.waitingRoomEnabled ?? false,
            muteOnEntry: dto.settings?.muteOnEntry ?? true,
            screenShareScope: "HOST_ONLY",
            allowRecording: true,
            maxParticipants: 300,
          },
        },
        chatRoom: { create: { type: "MEETING" } },
      },
    });

    return this.prisma.client.classSession.create({
      data: {
        classId,
        meetingId: meeting.id,
        sessionDate: dto.sessionDate ? new Date(dto.sessionDate) : new Date(),
        title: dto.title,
      },
      include: { meeting: { include: { settings: true } } },
    });
  }

  async listSessions(classId: string, callerUserId: string) {
    await this.requireMember(classId, callerUserId);
    return this.prisma.client.classSession.findMany({
      where: { classId },
      include: { meeting: { select: { id: true, code: true, status: true, actualStart: true, actualEnd: true } } },
      orderBy: { sessionDate: "desc" },
    });
  }

  async requireTeacher(classId: string, userId: string): Promise<void> {
    const teacher = await this.prisma.client.classTeacher.findUnique({
      where: { classId_userId: { classId, userId } },
    });
    if (!teacher) throw new ForbiddenException("Only a teacher of this class can do that");
  }

  /** Non-throwing check, for callers that need to branch on role rather than
   * reject non-teachers outright (e.g. deciding what to include in a response
   * rather than deciding whether to allow the request at all). */
  async isTeacher(classId: string, userId: string): Promise<boolean> {
    const teacher = await this.prisma.client.classTeacher.findUnique({
      where: { classId_userId: { classId, userId } },
    });
    return Boolean(teacher);
  }

  async requireMember(classId: string, userId: string): Promise<void> {
    const [teacher, student] = await Promise.all([
      this.prisma.client.classTeacher.findUnique({ where: { classId_userId: { classId, userId } } }),
      this.prisma.client.classStudent.findUnique({ where: { classId_userId: { classId, userId } } }),
    ]);
    if (!teacher && !student) throw new ForbiddenException("Not a member of this class");
  }
}
