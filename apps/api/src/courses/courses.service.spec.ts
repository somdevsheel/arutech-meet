import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { CoursesService } from "./courses.service";
import type { PrismaService } from "../prisma/prisma.service";

const COURSE = {
  id: "course-1",
  orgId: null as string | null,
  createdById: "teacher-1",
  title: "Intro to Biology",
  description: null as string | null,
  deletedAt: null as Date | null,
};

function makeDeps(overrides?: { course?: unknown }) {
  const prisma = {
    client: {
      membership: { findUnique: jest.fn().mockResolvedValue({ orgId: "org-1", userId: "teacher-1" }) },
      course: {
        create: jest.fn().mockResolvedValue(COURSE),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...COURSE, ...data })),
        findUnique: jest.fn().mockResolvedValue(overrides?.course === null ? null : overrides?.course ?? COURSE),
        findFirst: jest.fn().mockResolvedValue(overrides?.course === undefined ? COURSE : overrides.course),
        findMany: jest.fn().mockResolvedValue([COURSE]),
      },
    },
  } as unknown as PrismaService;

  return { prisma };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new CoursesService(deps.prisma);
}

describe("CoursesService.create", () => {
  it("creates a course owned by the caller", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    const result = await service.create("teacher-1", { title: "Intro to Biology" });
    expect(deps.prisma.client.course.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdById: "teacher-1" }) }),
    );
    expect(result).toMatchObject({ title: "Intro to Biology" });
  });

  it("refuses to create a course under an org the caller doesn't belong to", async () => {
    const deps = makeDeps();
    (deps.prisma.client.membership.findUnique as jest.Mock).mockResolvedValue(null);
    const service = makeService(deps);
    await expect(service.create("teacher-1", { title: "X", orgId: "org-2" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe("CoursesService.update / remove", () => {
  it("only the creator can update a course", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await expect(service.update("course-1", "not-the-creator", { title: "New" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("the creator can update their own course", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    const result = await service.update("course-1", "teacher-1", { title: "New title" });
    expect(result).toMatchObject({ title: "New title" });
  });

  it("404s on a course that doesn't exist", async () => {
    const deps = makeDeps({ course: null });
    const service = makeService(deps);
    await expect(service.update("missing", "teacher-1", { title: "X" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("soft-deletes without touching its batches", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await service.remove("course-1", "teacher-1");
    expect(deps.prisma.client.course.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
  });
});

describe("CoursesService.assertOwnedCourse", () => {
  it("passes for the course's own creator", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await expect(service.assertOwnedCourse("course-1", "teacher-1")).resolves.toBeUndefined();
  });

  it("refuses a class being attached to someone else's course", async () => {
    const deps = makeDeps();
    const service = makeService(deps);
    await expect(service.assertOwnedCourse("course-1", "someone-else")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe("CoursesService.findById", () => {
  it("allows a course's creator to view it", async () => {
    const deps = makeDeps();
    (deps.prisma.client.course.findFirst as jest.Mock).mockResolvedValue(COURSE);
    const service = makeService(deps);
    await expect(service.findById("course-1", "teacher-1")).resolves.toBeDefined();
  });

  it("refuses someone with no relationship to the course", async () => {
    const deps = makeDeps();
    (deps.prisma.client.course.findFirst as jest.Mock).mockResolvedValue(null);
    const service = makeService(deps);
    await expect(service.findById("course-1", "stranger")).rejects.toBeInstanceOf(ForbiddenException);
  });
});
