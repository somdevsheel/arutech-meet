import { AttendanceService } from "./attendance.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { ClassesService } from "./classes.service";

interface FakeEvent {
  userId: string;
  type: "MEDIA_CONNECTED" | "MEDIA_DISCONNECTED";
  createdAt: Date;
}

function minutesAgo(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

function makePrismaMock(opts: {
  events: FakeEvent[];
  students: { userId: string; status: "ACTIVE" | "REMOVED" }[];
  actualStart: Date | null;
  actualEnd: Date | null;
}) {
  const upserts: unknown[] = [];
  return {
    upserts,
    prisma: {
      client: {
        classSession: {
          findUnique: jest.fn().mockResolvedValue({
            id: "session-1",
            classId: "class-1",
            meetingId: "meeting-1",
            meeting: { actualStart: opts.actualStart, actualEnd: opts.actualEnd },
            class: { students: opts.students },
          }),
        },
        meetingEvent: {
          findMany: jest.fn().mockResolvedValue(opts.events),
        },
        attendance: {
          upsert: jest.fn().mockImplementation(({ create }) => {
            upserts.push(create);
            return Promise.resolve(create);
          }),
          findMany: jest.fn(),
        },
      },
    } as unknown as PrismaService,
  };
}

function makeClassesServiceMock(): ClassesService {
  return { requireTeacher: jest.fn().mockResolvedValue(undefined) } as unknown as ClassesService;
}

describe("AttendanceService.recompute", () => {
  const sessionStart = new Date("2026-01-01T10:00:00.000Z");
  const sessionEnd = new Date("2026-01-01T11:00:00.000Z"); // 60-minute session

  it("marks a student PRESENT when they stayed for the whole session", async () => {
    const { prisma, upserts } = makePrismaMock({
      events: [
        { userId: "student-1", type: "MEDIA_CONNECTED", createdAt: sessionStart },
        { userId: "student-1", type: "MEDIA_DISCONNECTED", createdAt: sessionEnd },
      ],
      students: [{ userId: "student-1", status: "ACTIVE" }],
      actualStart: sessionStart,
      actualEnd: sessionEnd,
    });
    const service = new AttendanceService(prisma, makeClassesServiceMock());

    await service.recompute("session-1", "teacher-1");

    expect(upserts).toHaveLength(1);
    const row = upserts[0] as { status: string; durationSeconds: number; rejoinCount: number };
    expect(row.status).toBe("PRESENT");
    expect(row.durationSeconds).toBe(3600);
    expect(row.rejoinCount).toBe(0);
  });

  it("marks a student PARTIAL when they left early", async () => {
    const { prisma, upserts } = makePrismaMock({
      events: [
        { userId: "student-1", type: "MEDIA_CONNECTED", createdAt: sessionStart },
        { userId: "student-1", type: "MEDIA_DISCONNECTED", createdAt: minutesAgo(sessionStart, 20) },
      ],
      students: [{ userId: "student-1", status: "ACTIVE" }],
      actualStart: sessionStart,
      actualEnd: sessionEnd,
    });
    const service = new AttendanceService(prisma, makeClassesServiceMock());

    await service.recompute("session-1", "teacher-1");

    const row = upserts[0] as { status: string; durationSeconds: number };
    expect(row.status).toBe("PARTIAL");
    expect(row.durationSeconds).toBe(20 * 60);
  });

  it("marks a student ABSENT when they never joined", async () => {
    const { prisma, upserts } = makePrismaMock({
      events: [],
      students: [{ userId: "student-1", status: "ACTIVE" }],
      actualStart: sessionStart,
      actualEnd: sessionEnd,
    });
    const service = new AttendanceService(prisma, makeClassesServiceMock());

    await service.recompute("session-1", "teacher-1");

    const row = upserts[0] as { status: string; durationSeconds: number };
    expect(row.status).toBe("ABSENT");
    expect(row.durationSeconds).toBe(0);
  });

  it("counts rejoins and sums durations across multiple connect/disconnect pairs", async () => {
    const { prisma, upserts } = makePrismaMock({
      events: [
        { userId: "student-1", type: "MEDIA_CONNECTED", createdAt: sessionStart },
        { userId: "student-1", type: "MEDIA_DISCONNECTED", createdAt: minutesAgo(sessionStart, 10) },
        { userId: "student-1", type: "MEDIA_CONNECTED", createdAt: minutesAgo(sessionStart, 15) },
        { userId: "student-1", type: "MEDIA_DISCONNECTED", createdAt: minutesAgo(sessionStart, 55) },
      ],
      students: [{ userId: "student-1", status: "ACTIVE" }],
      actualStart: sessionStart,
      actualEnd: sessionEnd,
    });
    const service = new AttendanceService(prisma, makeClassesServiceMock());

    await service.recompute("session-1", "teacher-1");

    const row = upserts[0] as { status: string; durationSeconds: number; rejoinCount: number };
    expect(row.rejoinCount).toBe(1);
    expect(row.durationSeconds).toBe(10 * 60 + 40 * 60); // two intervals: 10min + 40min
    expect(row.status).toBe("PRESENT"); // 50/60 = 83% >= 80% threshold
  });

  it("leaves a still-open interval counted through session end rather than dropped", async () => {
    const { prisma, upserts } = makePrismaMock({
      events: [{ userId: "student-1", type: "MEDIA_CONNECTED", createdAt: minutesAgo(sessionStart, 50) }],
      students: [{ userId: "student-1", status: "ACTIVE" }],
      actualStart: sessionStart,
      actualEnd: sessionEnd,
    });
    const service = new AttendanceService(prisma, makeClassesServiceMock());

    await service.recompute("session-1", "teacher-1");

    const row = upserts[0] as { durationSeconds: number };
    expect(row.durationSeconds).toBe(10 * 60); // connected at +50min, session ends at +60min
  });

  it("excludes students removed from the class roster", async () => {
    const { prisma, upserts } = makePrismaMock({
      events: [],
      students: [
        { userId: "student-1", status: "ACTIVE" },
        { userId: "student-2", status: "REMOVED" },
      ],
      actualStart: sessionStart,
      actualEnd: sessionEnd,
    });
    const service = new AttendanceService(prisma, makeClassesServiceMock());

    await service.recompute("session-1", "teacher-1");

    expect(upserts).toHaveLength(1);
  });
});
