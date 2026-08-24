import { BadRequestException } from "@nestjs/common";
import { CalendarService } from "./calendar.service";
import type { PrismaService } from "../prisma/prisma.service";

const USER = "user-1";

function makeService(overrides?: { meetings?: unknown[]; sessions?: unknown[] }) {
  const prisma = {
    client: {
      meeting: { findMany: jest.fn().mockResolvedValue(overrides?.meetings ?? []) },
      classSession: { findMany: jest.fn().mockResolvedValue(overrides?.sessions ?? []) },
    },
  } as unknown as PrismaService;
  return { service: new CalendarService(prisma), prisma };
}

describe("CalendarService", () => {
  describe("listEvents", () => {
    it("rejects an inverted range", async () => {
      const { service } = makeService();
      await expect(
        service.listEvents(USER, new Date("2026-02-01"), new Date("2026-01-01")),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a range longer than the max window", async () => {
      const { service } = makeService();
      await expect(
        service.listEvents(USER, new Date("2020-01-01"), new Date("2026-01-01")),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("shapes a plain scheduled meeting", async () => {
      const { service } = makeService({
        meetings: [
          {
            id: "m1",
            code: "abc-def-ghi",
            title: "Standup",
            status: "SCHEDULED",
            ownerId: USER,
            scheduledStart: new Date("2026-01-05T09:00:00Z"),
            scheduledEnd: new Date("2026-01-05T09:30:00Z"),
            recurrenceFrequency: null,
            recurrenceUntil: null,
          },
        ],
      });
      const events = await service.listEvents(USER, new Date("2026-01-01"), new Date("2026-01-31"));
      expect(events).toEqual([
        expect.objectContaining({
          id: "m1",
          kind: "MEETING",
          title: "Standup",
          start: "2026-01-05T09:00:00.000Z",
          end: "2026-01-05T09:30:00.000Z",
          isOwner: true,
          isRecurringOccurrence: false,
        }),
      ]);
    });

    it("projects a WEEKLY recurring meeting into every occurrence in range", async () => {
      const { service } = makeService({
        meetings: [
          {
            id: "m2",
            code: "rec-rec-rec",
            title: "Weekly sync",
            status: "SCHEDULED",
            ownerId: "someone-else",
            scheduledStart: new Date("2026-01-05T10:00:00Z"), // a Monday
            scheduledEnd: new Date("2026-01-05T10:30:00Z"),
            recurrenceFrequency: "WEEKLY",
            recurrenceUntil: null,
          },
        ],
      });
      const events = await service.listEvents(USER, new Date("2026-01-01"), new Date("2026-01-31"));
      expect(events).toHaveLength(4); // Jan 5, 12, 19, 26
      expect(events.every((e) => e.isRecurringOccurrence)).toBe(true);
      expect(events.every((e) => e.isOwner === false)).toBe(true);
      expect(events[0]?.start).toBe("2026-01-05T10:00:00.000Z");
      expect(events[1]?.start).toBe("2026-01-12T10:00:00.000Z");
      expect(events[3]?.start).toBe("2026-01-26T10:00:00.000Z");
      // Every occurrence shares the one real meeting id/code — no per-date row.
      expect(new Set(events.map((e) => e.meetingId))).toEqual(new Set(["m2"]));
      expect(new Set(events.map((e) => e.id)).size).toBe(4); // but display ids are distinct
    });

    it("stops projecting a recurring meeting past its recurrenceUntil", async () => {
      const { service } = makeService({
        meetings: [
          {
            id: "m3",
            code: "rec-end-end",
            title: "Short series",
            status: "SCHEDULED",
            ownerId: USER,
            scheduledStart: new Date("2026-01-01T10:00:00Z"),
            scheduledEnd: null,
            recurrenceFrequency: "DAILY",
            recurrenceUntil: new Date("2026-01-03T23:59:59Z"),
          },
        ],
      });
      const events = await service.listEvents(USER, new Date("2026-01-01"), new Date("2026-01-31"));
      expect(events).toHaveLength(3); // Jan 1, 2, 3 — stops at recurrenceUntil
      expect(events.every((e) => e.end === null)).toBe(true); // no scheduledEnd -> no duration to project
    });

    it("fast-forwards a long-running weekly series to the requested window", async () => {
      const { service } = makeService({
        meetings: [
          {
            id: "m4",
            code: "old-old-old",
            title: "Standing meeting",
            status: "SCHEDULED",
            ownerId: USER,
            scheduledStart: new Date("2020-01-06T10:00:00Z"), // years before the query window
            scheduledEnd: null,
            recurrenceFrequency: "WEEKLY",
            recurrenceUntil: null,
          },
        ],
      });
      const events = await service.listEvents(USER, new Date("2026-01-05"), new Date("2026-01-11"));
      expect(events).toHaveLength(1);
      expect(events[0]?.start).toBe("2026-01-05T10:00:00.000Z");
    });

    it("includes a class session, scheduled via sessionDate rather than the meeting's own scheduledStart", async () => {
      const { service } = makeService({
        sessions: [
          {
            id: "s1",
            classId: "class-1",
            meetingId: "m5",
            sessionDate: new Date("2026-01-10T14:00:00Z"),
            title: null,
            meeting: { id: "m5", code: "cls-cls-cls", status: "SCHEDULED", ownerId: "teacher-1" },
            class: { title: "Algebra II" },
          },
        ],
      });
      const events = await service.listEvents(USER, new Date("2026-01-01"), new Date("2026-01-31"));
      expect(events).toEqual([
        expect.objectContaining({
          id: "s1",
          kind: "CLASS",
          title: "Algebra II",
          start: "2026-01-10T14:00:00.000Z",
          classId: "class-1",
          className: "Algebra II",
          meetingCode: "cls-cls-cls",
          isOwner: false,
        }),
      ]);
    });

    it("sorts meetings and class sessions together by start time", async () => {
      const { service } = makeService({
        meetings: [
          {
            id: "m6",
            code: "later-later",
            title: "Later meeting",
            status: "SCHEDULED",
            ownerId: USER,
            scheduledStart: new Date("2026-01-20T10:00:00Z"),
            scheduledEnd: null,
            recurrenceFrequency: null,
            recurrenceUntil: null,
          },
        ],
        sessions: [
          {
            id: "s2",
            classId: "class-1",
            meetingId: "m7",
            sessionDate: new Date("2026-01-02T09:00:00Z"),
            title: "Earlier class",
            meeting: { id: "m7", code: "earlier-cls", status: "SCHEDULED", ownerId: USER },
            class: { title: "Algebra II" },
          },
        ],
      });
      const events = await service.listEvents(USER, new Date("2026-01-01"), new Date("2026-01-31"));
      expect(events.map((e) => e.id)).toEqual(["s2", "m6"]);
    });
  });
});
