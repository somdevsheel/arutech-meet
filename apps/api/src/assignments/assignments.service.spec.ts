import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { AssignmentsService } from "./assignments.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import type { ClassesService } from "../classes/classes.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { OrganizationsService } from "../organizations/organizations.service";

const ASSIGNMENT = {
  id: "assign-1",
  classId: "class-1",
  createdById: "teacher-1",
  title: "Essay 1",
  fileId: null as string | null,
  deletedAt: null as Date | null,
};

function makeDeps(overrides?: {
  requireTeacherFails?: boolean;
  student?: { status: string } | null;
  existingSubmission?: unknown;
  classOrgId?: string | null;
}) {
  const prisma = {
    client: {
      class: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ orgId: overrides?.classOrgId ?? null }),
      },
      assignment: {
        create: jest.fn().mockResolvedValue(ASSIGNMENT),
        update: jest.fn().mockResolvedValue(ASSIGNMENT),
        findUnique: jest.fn().mockResolvedValue(ASSIGNMENT),
        findMany: jest.fn().mockResolvedValue([ASSIGNMENT]),
      },
      assignmentSubmission: {
        findUnique: jest.fn().mockResolvedValue(overrides?.existingSubmission ?? null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "sub-1", ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "sub-1", ...data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      classStudent: {
        findUnique: jest.fn().mockResolvedValue(
          overrides?.student === null ? null : overrides?.student ?? { status: "ACTIVE" },
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      classTeacher: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      fileAsset: {
        create: jest.fn().mockResolvedValue({ id: "file-1" }),
        findUnique: jest.fn(),
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "student-1", displayName: "Stu" }),
      },
    },
  } as unknown as PrismaService;

  const storage = {
    getSignedUploadUrl: jest.fn().mockResolvedValue("https://upload.example"),
    getSignedDownloadUrl: jest.fn().mockResolvedValue("https://download.example"),
  } as unknown as StorageService;

  const classes = {
    requireTeacher: overrides?.requireTeacherFails
      ? jest.fn().mockRejectedValue(new ForbiddenException())
      : jest.fn().mockResolvedValue(undefined),
    requireMember: jest.fn().mockResolvedValue(undefined),
  } as unknown as ClassesService;

  const notifications = { create: jest.fn() } as unknown as NotificationsService;

  const organizations = {
    assertStorageOk: jest.fn().mockResolvedValue(undefined),
  } as unknown as OrganizationsService;

  return { prisma, storage, classes, notifications, organizations };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new AssignmentsService(
    deps.prisma,
    deps.storage,
    deps.classes,
    deps.notifications,
    deps.organizations,
  );
}

describe("AssignmentsService.create", () => {
  it("requires the caller to teach the class", async () => {
    const deps = makeDeps({ requireTeacherFails: true });
    const service = makeService(deps);
    await expect(
      service.create("class-1", "not-a-teacher", { title: "Essay 1" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("notifies every active student when an assignment is posted", async () => {
    const deps = makeDeps();
    (deps.prisma.client.classStudent.findMany as jest.Mock).mockResolvedValue([
      { userId: "student-1" },
      { userId: "student-2" },
    ]);
    const service = makeService(deps);

    await service.create("class-1", "teacher-1", { title: "Essay 1" });

    expect(deps.notifications.create).toHaveBeenCalledTimes(2);
    expect(deps.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "student-1", type: "ASSIGNMENT" }),
    );
  });
});

describe("AssignmentsService.submit", () => {
  it("refuses a teacher (not an enrolled student) from submitting", async () => {
    const deps = makeDeps({ student: null });
    const service = makeService(deps);
    await expect(
      service.submit("class-1", "assign-1", "teacher-1", { textContent: "answer" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses a removed (inactive) student", async () => {
    const deps = makeDeps({ student: { status: "REMOVED" } });
    const service = makeService(deps);
    await expect(
      service.submit("class-1", "assign-1", "student-1", { textContent: "answer" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("creates a new submission with status SUBMITTED on first attempt", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    const result = await service.submit("class-1", "assign-1", "student-1", { textContent: "my answer" });

    expect(deps.prisma.client.assignmentSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ textContent: "my answer" }) }),
    );
    expect(result).toMatchObject({ textContent: "my answer" });
  });

  it("resubmission overwrites the existing row and clears any prior grade", async () => {
    const deps = makeDeps({
      existingSubmission: { id: "sub-1", assignmentId: "assign-1", studentId: "student-1", score: 90 },
    });
    const service = makeService(deps);

    await service.submit("class-1", "assign-1", "student-1", { textContent: "revised answer" });

    expect(deps.prisma.client.assignmentSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sub-1" },
        data: expect.objectContaining({ status: "RESUBMITTED", score: null, feedback: null, gradedAt: null }),
      }),
    );
    expect(deps.prisma.client.assignmentSubmission.create).not.toHaveBeenCalled();
  });
});

describe("AssignmentsService.grade", () => {
  it("requires the caller to teach the class", async () => {
    const deps = makeDeps({ requireTeacherFails: true });
    const service = makeService(deps);
    await expect(
      service.grade("class-1", "assign-1", "student-1", "not-a-teacher", { score: 90 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("404s grading a student who never submitted", async () => {
    const deps = makeDeps();
    (deps.prisma.client.assignmentSubmission.findUnique as jest.Mock).mockResolvedValue(null);
    const service = makeService(deps);
    await expect(
      service.grade("class-1", "assign-1", "student-1", "teacher-1", { score: 90 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("grades and notifies the student", async () => {
    const deps = makeDeps({ existingSubmission: { id: "sub-1" } });
    const service = makeService(deps);

    await service.grade("class-1", "assign-1", "student-1", "teacher-1", { score: 85, feedback: "Good work" });

    expect(deps.prisma.client.assignmentSubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ score: 85, feedback: "Good work", status: "GRADED" }),
      }),
    );
    expect(deps.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "student-1", type: "ASSIGNMENT" }),
    );
  });
});

describe("AssignmentsService.getAttachmentDownloadUrl", () => {
  it("allows downloading the assignment's own material", async () => {
    const deps = makeDeps();
    (deps.prisma.client.assignment.findUnique as jest.Mock).mockResolvedValue({ ...ASSIGNMENT, fileId: "file-1" });
    (deps.prisma.client.fileAsset.findUnique as jest.Mock).mockResolvedValue({
      id: "file-1",
      classId: "class-1",
      storageKey: "k",
      originalName: "n",
      mimeType: "application/pdf",
      virusScanStatus: "PENDING",
    });
    const service = makeService(deps);

    const result = await service.getAttachmentDownloadUrl("class-1", "assign-1", "student-1", "file-1");
    expect(result.url).toBe("https://download.example");
  });

  it("refuses a student trying to download another student's submission", async () => {
    const deps = makeDeps();
    (deps.prisma.client.fileAsset.findUnique as jest.Mock).mockResolvedValue({
      id: "someone-elses-file",
      classId: "class-1",
      storageKey: "k",
      originalName: "n",
      mimeType: "application/pdf",
      virusScanStatus: "PENDING",
    });
    // Caller's own submission has a different fileId (or none), and they're not a teacher.
    (deps.prisma.client.assignmentSubmission.findUnique as jest.Mock).mockResolvedValue({
      fileId: "my-own-file",
    });
    const service = makeService(deps);

    await expect(
      service.getAttachmentDownloadUrl("class-1", "assign-1", "student-1", "someone-elses-file"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// Regression coverage: this path created FileAsset rows with no orgId and
// never checked the org's storage limit at all, so an org's quota silently
// never applied to classroom assignment attachments no matter how much was
// uploaded through it — see git history for the finding.
describe("AssignmentsService.presignAttachment", () => {
  it("checks the org's storage limit for a class that belongs to an org", async () => {
    const deps = makeDeps({ classOrgId: "org-1" });
    const service = makeService(deps);

    await service.presignAttachment("class-1", "student-1", {
      fileName: "notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });

    expect(deps.organizations.assertStorageOk).toHaveBeenCalledWith("org-1", 1024);
    expect(deps.prisma.client.fileAsset.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: "org-1" }) }),
    );
  });

  it("never checks the limit for a personal (non-org) class", async () => {
    const deps = makeDeps({ classOrgId: null });
    const service = makeService(deps);

    await service.presignAttachment("class-1", "student-1", {
      fileName: "notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });

    expect(deps.organizations.assertStorageOk).not.toHaveBeenCalled();
  });

  it("propagates a storage-limit rejection instead of creating the file", async () => {
    const deps = makeDeps({ classOrgId: "org-1" });
    (deps.organizations.assertStorageOk as jest.Mock).mockRejectedValue(new ForbiddenException("limit reached"));
    const service = makeService(deps);

    await expect(
      service.presignAttachment("class-1", "student-1", {
        fileName: "notes.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(deps.prisma.client.fileAsset.create).not.toHaveBeenCalled();
  });
});
