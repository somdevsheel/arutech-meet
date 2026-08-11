import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ClassesService } from "./classes.service";

interface ComputedAttendance {
  userId: string;
  joinedAt: Date | null;
  leftAt: Date | null;
  durationSeconds: number;
  rejoinCount: number;
  /** Start of the currently-open CONNECTED interval, if any (cleared once matched
   * with a DISCONNECTED event or closed out at session end). */
  openAt?: Date;
}

/** Fraction of the session's wall-clock length a student must have been
 * present for to count as PRESENT rather than PARTIAL. */
const PRESENT_THRESHOLD = 0.8;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classes: ClassesService,
  ) {}

  /**
   * Derives attendance from the meeting's MEDIA_CONNECTED/MEDIA_DISCONNECTED
   * event log (real LiveKit webhook-sourced presence, not the app-level
   * "admitted" event — see docs/database.md §Attendance computation) and
   * upserts one `attendance` row per enrolled student. Safe to call multiple
   * times (e.g. periodically while the class is still live, and once more
   * after it ends) — it always recomputes from the full event log rather than
   * incrementing.
   */
  async recompute(classSessionId: string, callerUserId: string) {
    const session = await this.prisma.client.classSession.findUnique({
      where: { id: classSessionId },
      include: { meeting: true, class: { include: { students: true } } },
    });
    if (!session) throw new NotFoundException("Class session not found");
    await this.classes.requireTeacher(session.classId, callerUserId);

    const events = await this.prisma.client.meetingEvent.findMany({
      where: {
        meetingId: session.meetingId,
        userId: { not: null },
        type: { in: ["MEDIA_CONNECTED", "MEDIA_DISCONNECTED"] },
      },
      orderBy: { createdAt: "asc" },
    });

    const sessionEnd = session.meeting.actualEnd ?? new Date();
    const byUser = new Map<string, ComputedAttendance>();

    for (const event of events) {
      const userId = event.userId as string;
      let acc = byUser.get(userId);
      if (!acc) {
        acc = { userId, joinedAt: null, leftAt: null, durationSeconds: 0, rejoinCount: -1 };
        byUser.set(userId, acc);
      }

      if (event.type === "MEDIA_CONNECTED") {
        acc.rejoinCount += 1;
        if (!acc.joinedAt) acc.joinedAt = event.createdAt;
        acc.openAt = event.createdAt;
      } else if (event.type === "MEDIA_DISCONNECTED") {
        if (acc.openAt) {
          acc.durationSeconds += Math.max(
            0,
            Math.floor((event.createdAt.getTime() - acc.openAt.getTime()) / 1000),
          );
          acc.openAt = undefined;
        }
        acc.leftAt = event.createdAt;
      }
    }

    // Close out any interval still open at session end (still connected / abrupt end).
    for (const acc of byUser.values()) {
      if (acc.openAt) {
        acc.durationSeconds += Math.max(0, Math.floor((sessionEnd.getTime() - acc.openAt.getTime()) / 1000));
        acc.leftAt = sessionEnd;
        acc.openAt = undefined;
      }
      if (acc.rejoinCount < 0) acc.rejoinCount = 0;
    }

    const sessionLengthSeconds = session.meeting.actualStart
      ? Math.max(1, Math.floor((sessionEnd.getTime() - session.meeting.actualStart.getTime()) / 1000))
      : null;

    const results = [];
    for (const student of session.class.students.filter((s) => s.status === "ACTIVE")) {
      const acc = byUser.get(student.userId);
      const durationSeconds = acc?.durationSeconds ?? 0;
      const status =
        durationSeconds === 0
          ? "ABSENT"
          : sessionLengthSeconds && durationSeconds / sessionLengthSeconds >= PRESENT_THRESHOLD
            ? "PRESENT"
            : "PARTIAL";

      const row = await this.prisma.client.attendance.upsert({
        where: { classSessionId_userId: { classSessionId, userId: student.userId } },
        create: {
          classSessionId,
          userId: student.userId,
          joinedAt: acc?.joinedAt ?? null,
          leftAt: acc?.leftAt ?? null,
          durationSeconds,
          rejoinCount: acc?.rejoinCount ?? 0,
          status,
        },
        update: {
          joinedAt: acc?.joinedAt ?? null,
          leftAt: acc?.leftAt ?? null,
          durationSeconds,
          rejoinCount: acc?.rejoinCount ?? 0,
          status,
        },
      });
      results.push(row);
    }

    return results;
  }

  async get(classSessionId: string, callerUserId: string) {
    const session = await this.prisma.client.classSession.findUnique({ where: { id: classSessionId } });
    if (!session) throw new NotFoundException("Class session not found");
    await this.classes.requireMember(session.classId, callerUserId);

    return this.prisma.client.attendance.findMany({
      where: { classSessionId },
      include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
      orderBy: { user: { displayName: "asc" } },
    });
  }

  async exportCsv(classSessionId: string, callerUserId: string): Promise<string> {
    const rows = await this.get(classSessionId, callerUserId);
    const header = "Student,Joined,Left,Duration (min),Rejoins,Status";
    const lines = rows.map((r) =>
      [
        csvEscape(r.user.displayName),
        r.joinedAt?.toISOString() ?? "",
        r.leftAt?.toISOString() ?? "",
        Math.round(r.durationSeconds / 60).toString(),
        r.rejoinCount.toString(),
        r.status,
      ].join(","),
    );
    return [header, ...lines].join("\n");
  }
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
