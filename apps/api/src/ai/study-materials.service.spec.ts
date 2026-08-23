import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { StudyMaterialsService } from "./study-materials.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { ClassesService } from "../classes/classes.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { SummarizationProvider } from "./providers/summarization-provider.interface";

const TRANSCRIPT = {
  id: "transcript-1",
  meetingId: "meeting-1",
  status: "READY" as const,
  segments: [{ id: "seg-1", startMs: 0, endMs: 1000, text: "Hello class", speakerLabel: "Teacher" }],
};

const GENERATED = {
  title: "Intro lecture",
  lectureNotes: "# Notes",
  studyGuide: "# Guide",
  flashcards: [{ front: "Q", back: "A" }],
  practiceQuestions: [{ question: "2+2?", options: [{ text: "4", isCorrect: true }] }],
};

const MATERIAL = {
  id: "material-1",
  classId: "class-1",
  transcriptId: "transcript-1",
  createdByUserId: "teacher-1",
  status: "DRAFT" as const,
  title: "Intro lecture",
};

function makeDeps(overrides?: {
  requireTeacherFails?: boolean;
  isTeacher?: boolean;
  transcript?: unknown;
  session?: unknown;
  material?: unknown;
}) {
  const prisma = {
    client: {
      meetingTranscript: {
        findUnique: jest.fn().mockResolvedValue(overrides?.transcript === undefined ? TRANSCRIPT : overrides.transcript),
        findMany: jest.fn().mockResolvedValue([]),
      },
      classSession: {
        findFirst: jest.fn().mockResolvedValue(overrides?.session === undefined ? { id: "session-1" } : overrides.session),
        findMany: jest.fn().mockResolvedValue([]),
      },
      classroomStudyMaterial: {
        create: jest.fn().mockResolvedValue(MATERIAL),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...MATERIAL, ...data })),
        delete: jest.fn().mockResolvedValue(undefined),
        findUnique: jest.fn().mockResolvedValue(overrides?.material === undefined ? MATERIAL : overrides.material),
        findMany: jest.fn().mockResolvedValue([MATERIAL]),
      },
      classStudent: {
        findMany: jest.fn().mockResolvedValue([{ userId: "student-1" }]),
      },
    },
  } as unknown as PrismaService;

  const classes = {
    requireTeacher: overrides?.requireTeacherFails
      ? jest.fn().mockRejectedValue(new ForbiddenException())
      : jest.fn().mockResolvedValue(undefined),
    requireMember: jest.fn().mockResolvedValue(undefined),
    isTeacher: jest.fn().mockResolvedValue(overrides?.isTeacher ?? true),
  } as unknown as ClassesService;

  const notifications = { create: jest.fn() } as unknown as NotificationsService;

  const summarizationProvider = {
    name: "openai",
    summarize: jest.fn(),
    generateStudyMaterial: jest.fn().mockResolvedValue(GENERATED),
  } as unknown as SummarizationProvider;

  return { prisma, classes, notifications, summarizationProvider };
}

function makeService(deps: ReturnType<typeof makeDeps>) {
  return new StudyMaterialsService(deps.prisma, deps.classes, deps.notifications, deps.summarizationProvider);
}

describe("StudyMaterialsService.generate", () => {
  it("requires the caller to teach the class", async () => {
    const deps = makeDeps({ requireTeacherFails: true });
    const service = makeService(deps);
    await expect(service.generate("class-1", "not-a-teacher", { transcriptId: "transcript-1" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("refuses a transcript that isn't READY yet", async () => {
    const deps = makeDeps({ transcript: { ...TRANSCRIPT, status: "PROCESSING" } });
    const service = makeService(deps);
    await expect(service.generate("class-1", "teacher-1", { transcriptId: "transcript-1" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("refuses a transcript that doesn't belong to a session of this class", async () => {
    const deps = makeDeps({ session: null });
    const service = makeService(deps);
    await expect(service.generate("class-1", "teacher-1", { transcriptId: "transcript-1" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("creates a DRAFT material from the provider's result and never notifies anyone yet", async () => {
    const deps = makeDeps();
    const service = makeService(deps);

    await service.generate("class-1", "teacher-1", { transcriptId: "transcript-1" });

    expect(deps.summarizationProvider.generateStudyMaterial).toHaveBeenCalled();
    expect(deps.prisma.client.classroomStudyMaterial.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT", title: "Intro lecture" }) }),
    );
    expect(deps.notifications.create).not.toHaveBeenCalled();
  });
});

describe("StudyMaterialsService.list / getOne — DRAFT visibility", () => {
  it("a teacher's list includes DRAFT rows (no status filter)", async () => {
    const deps = makeDeps({ isTeacher: true });
    const service = makeService(deps);
    await service.list("class-1", "teacher-1");
    expect(deps.prisma.client.classroomStudyMaterial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { classId: "class-1" } }),
    );
  });

  it("a student's list is filtered to PUBLISHED only", async () => {
    const deps = makeDeps({ isTeacher: false });
    const service = makeService(deps);
    await service.list("class-1", "student-1");
    expect(deps.prisma.client.classroomStudyMaterial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { classId: "class-1", status: "PUBLISHED" } }),
    );
  });

  it("a student fetching a DRAFT material by id gets a 404, not the content", async () => {
    const deps = makeDeps({ isTeacher: false, material: { ...MATERIAL, status: "DRAFT" } });
    const service = makeService(deps);
    await expect(service.getOne("class-1", "material-1", "student-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("a teacher can fetch their own DRAFT material", async () => {
    const deps = makeDeps({ isTeacher: true, material: { ...MATERIAL, status: "DRAFT" } });
    const service = makeService(deps);
    await expect(service.getOne("class-1", "material-1", "teacher-1")).resolves.toBeDefined();
  });

  it("a student can fetch a PUBLISHED material", async () => {
    const deps = makeDeps({ isTeacher: false, material: { ...MATERIAL, status: "PUBLISHED" } });
    const service = makeService(deps);
    await expect(service.getOne("class-1", "material-1", "student-1")).resolves.toBeDefined();
  });
});

describe("StudyMaterialsService.publish", () => {
  it("only a teacher can publish", async () => {
    const deps = makeDeps({ requireTeacherFails: true });
    const service = makeService(deps);
    await expect(service.publish("class-1", "material-1", "not-a-teacher")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("publishes and notifies every active student", async () => {
    const deps = makeDeps({ material: { ...MATERIAL, status: "DRAFT" } });
    const service = makeService(deps);

    await service.publish("class-1", "material-1", "teacher-1");

    expect(deps.prisma.client.classroomStudyMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PUBLISHED" }) }),
    );
    expect(deps.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "student-1", type: "STUDY_MATERIAL" }),
    );
  });

  it("is a no-op (and re-notifies no one) if already published", async () => {
    const deps = makeDeps({ material: { ...MATERIAL, status: "PUBLISHED" } });
    const service = makeService(deps);

    await service.publish("class-1", "material-1", "teacher-1");

    expect(deps.prisma.client.classroomStudyMaterial.update).not.toHaveBeenCalled();
    expect(deps.notifications.create).not.toHaveBeenCalled();
  });
});

describe("StudyMaterialsService.remove", () => {
  it("only a teacher can delete", async () => {
    const deps = makeDeps({ requireTeacherFails: true });
    const service = makeService(deps);
    await expect(service.remove("class-1", "material-1", "not-a-teacher")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
