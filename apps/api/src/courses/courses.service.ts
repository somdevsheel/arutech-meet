import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateCourseDto, UpdateCourseDto } from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";

const BATCH_SELECT = {
  id: true,
  title: true,
  subject: true,
  createdAt: true,
  _count: { select: { students: true, teachers: true } },
} as const;

/** Courses are the shared curriculum identity across however many times it's
 * actually taught — see the schema comment on `Course`. There's no
 * `CourseTeacher` join table: a course has exactly one creator/owner (mirrors
 * `Class.ownerTeacherId`), and every other permission (who teaches which
 * batch, who's enrolled in which batch) stays entirely on the `Class`
 * ("batch") itself via `ClassesService` — a course grouping never changes who
 * can do what inside any individual batch. */
@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateCourseDto) {
    if (dto.orgId) {
      const membership = await this.prisma.client.membership.findUnique({
        where: { orgId_userId: { orgId: dto.orgId, userId } },
      });
      if (!membership) throw new ForbiddenException("You are not a member of that organization");
    }
    return this.prisma.client.course.create({
      data: {
        title: dto.title,
        description: dto.description,
        orgId: dto.orgId,
        createdById: userId,
      },
    });
  }

  /** Courses the caller created, plus any course that has at least one batch
   * the caller teaches or is enrolled in — so a teacher/student sees the
   * courses their classes belong to even if they didn't create the course
   * itself. */
  async listMine(userId: string) {
    return this.prisma.client.course.findMany({
      where: {
        deletedAt: null,
        OR: [
          { createdById: userId },
          { batches: { some: { teachers: { some: { userId } } } } },
          { batches: { some: { students: { some: { userId } } } } },
        ],
      },
      include: { _count: { select: { batches: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(courseId: string, userId: string) {
    const course = await this.getOrThrow(courseId);
    await this.requireAccess(course.id, userId);
    return this.prisma.client.course.findUnique({
      where: { id: course.id },
      include: {
        batches: {
          where: { deletedAt: null },
          select: BATCH_SELECT,
          orderBy: { createdAt: "desc" },
        },
      },
    });
  }

  async update(courseId: string, userId: string, dto: UpdateCourseDto) {
    const course = await this.requireOwner(courseId, userId);
    return this.prisma.client.course.update({
      where: { id: course.id },
      data: { title: dto.title, description: dto.description },
    });
  }

  async remove(courseId: string, userId: string): Promise<void> {
    const course = await this.requireOwner(courseId, userId);
    // Existing batches keep their courseId — they remain fully functional
    // classes on their own, they just no longer show up under an active
    // course grouping. No cascading deletion of real classroom data over a
    // grouping label being removed.
    await this.prisma.client.course.update({
      where: { id: course.id },
      data: { deletedAt: new Date() },
    });
  }

  /** A `courseId` supplied when creating/updating a `Class` must reference a
   * course the caller actually owns — otherwise anyone could attach their new
   * class as a "batch" of someone else's course by guessing its id. */
  async assertOwnedCourse(courseId: string, userId: string): Promise<void> {
    const course = await this.getOrThrow(courseId);
    if (course.createdById !== userId) {
      throw new ForbiddenException("You can only add batches to a course you created");
    }
  }

  private async requireOwner(courseId: string, userId: string) {
    const course = await this.getOrThrow(courseId);
    if (course.createdById !== userId) {
      throw new ForbiddenException("Only the course's creator can do that");
    }
    return course;
  }

  private async requireAccess(courseId: string, userId: string): Promise<void> {
    const course = await this.prisma.client.course.findFirst({
      where: {
        id: courseId,
        OR: [
          { createdById: userId },
          { batches: { some: { teachers: { some: { userId } } } } },
          { batches: { some: { students: { some: { userId } } } } },
        ],
      },
      select: { id: true },
    });
    if (!course) throw new ForbiddenException("Not a member of this course");
  }

  private async getOrThrow(courseId: string) {
    const course = await this.prisma.client.course.findUnique({ where: { id: courseId } });
    if (!course || course.deletedAt) throw new NotFoundException("Course not found");
    return course;
  }
}
