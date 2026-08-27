import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ClassesService } from "./classes.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { CoursesService } from "../courses/courses.service";

const CLASS = {
  id: "class-1",
  deletedAt: null as Date | null,
  teachers: [{ userId: "teacher-1" }],
  students: [{ userId: "student-1" }],
};

function makeDeps(overrides?: { klass?: unknown }) {
  const prisma = {
    client: {
      class: {
        findUnique: jest.fn().mockResolvedValue(overrides?.klass === undefined ? CLASS : overrides.klass),
      },
    },
  } as unknown as PrismaService;
  const courses = {} as CoursesService;

  return { prisma, courses };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new ClassesService(deps.prisma, deps.courses);
}

// This method used to take no userId at all and return the full roster to
// anyone who could guess a class UUID — see git history for the finding.
describe("ClassesService.findById", () => {
  it("throws NotFoundException when the class doesn't exist", async () => {
    const deps = makeDeps({ klass: null });
    const service = makeService(deps);

    await expect(service.findById("missing", "user-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws NotFoundException when the class is soft-deleted", async () => {
    const deps = makeDeps({ klass: { ...CLASS, deletedAt: new Date() } });
    const service = makeService(deps);

    await expect(service.findById("class-1", "teacher-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws ForbiddenException for a caller who is neither a teacher nor a student", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await expect(service.findById("class-1", "stranger")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("resolves for a teacher of the class", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await expect(service.findById("class-1", "teacher-1")).resolves.toMatchObject({ id: "class-1" });
  });

  it("resolves for a student of the class", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await expect(service.findById("class-1", "student-1")).resolves.toMatchObject({ id: "class-1" });
  });
});
