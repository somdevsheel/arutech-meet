import { BadRequestException, Injectable } from "@nestjs/common";
import type { RecurrenceFrequency } from "@arutech/database";
import type { CalendarEvent } from "@arutech/types";
import { PrismaService } from "../prisma/prisma.service";

// A RECURRING meeting is stored as exactly one `Meeting` row (a rule:
// scheduledStart + recurrenceFrequency + recurrenceUntil) — there is no
// per-occurrence row to query (see this file's own comment below and
// docs/roadmap.md's Calendar stage for why). This caps how many occurrences
// a single series projects into one request's response, so a DAILY series
// with no `recurrenceUntil` over a large `from`/`to` window can't return an
// unbounded list.
const MAX_OCCURRENCES_PER_SERIES = 200;

// Independent cap on the request's own date span, checked in the controller
// — keeps both this expansion and the underlying Prisma queries bounded
// regardless of what a client asks for.
export const MAX_RANGE_DAYS = 366;

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Everything on `userId`'s calendar between `from` and `to` (inclusive),
   * merged from two genuinely different sources and returned as one sorted
   * list:
   *
   * - `Meeting` rows with a `scheduledStart` (instant meetings without one
   *   are excluded — they have no calendar slot) that the caller owns or has
   *   already joined. Same visibility rule `MeetingsService.listMine` already
   *   uses — see that method's own comment for why (there's no targeted-
   *   invite endpoint in this codebase yet to check instead; noted honestly
   *   rather than invented here too).
   * - `ClassSession` rows (each 1:1 with its own `Meeting`, but scheduled via
   *   `sessionDate`, not that meeting's `scheduledStart` — `ClassesService.
   *   createSession` never sets it) for classes the caller teaches or is
   *   enrolled in.
   */
  async listEvents(userId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new BadRequestException("Invalid from/to range");
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      throw new BadRequestException(`Range too large — max ${MAX_RANGE_DAYS} days`);
    }

    const [meetings, sessions] = await Promise.all([
      this.prisma.client.meeting.findMany({
        where: {
          deletedAt: null,
          isPersonalRoom: false,
          type: { not: "CLASS" },
          scheduledStart: { not: null },
          OR: [{ ownerId: userId }, { participants: { some: { userId } } }],
          // Wrapped in AND rather than a second top-level `OR` key — Prisma's
          // where object only keeps the last value for a duplicate key, which
          // would silently drop the ownership check above instead of erroring.
          AND: [
            {
              OR: [
                // Non-recurring: the one scheduledStart itself must fall in range.
                { recurrenceFrequency: null, scheduledStart: { gte: from, lte: to } },
                // Recurring: the series only needs to *overlap* the window here —
                // which individual dates land inside it is resolved below in JS,
                // since occurrence math (every Nth day/week/month) isn't
                // expressible as a single SQL range.
                {
                  recurrenceFrequency: { not: null },
                  scheduledStart: { lte: to },
                  OR: [{ recurrenceUntil: null }, { recurrenceUntil: { gte: from } }],
                },
              ],
            },
          ],
        },
      }),
      this.prisma.client.classSession.findMany({
        where: {
          sessionDate: { gte: from, lte: to },
          class: {
            deletedAt: null,
            OR: [{ teachers: { some: { userId } } }, { students: { some: { userId } } }],
          },
        },
        include: { meeting: true, class: { select: { title: true } } },
      }),
    ]);

    const events: CalendarEvent[] = [];

    for (const m of meetings) {
      if (!m.scheduledStart) continue; // narrowed by the query above; guards TS only
      if (m.recurrenceFrequency) {
        const durationMs = m.scheduledEnd ? m.scheduledEnd.getTime() - m.scheduledStart.getTime() : null;
        for (const occurrence of expandRecurrence(m.scheduledStart, m.recurrenceFrequency, m.recurrenceUntil, from, to)) {
          events.push({
            id: `${m.id}:${occurrence.toISOString()}`,
            kind: "MEETING",
            title: m.title,
            start: occurrence.toISOString(),
            end: durationMs !== null ? new Date(occurrence.getTime() + durationMs).toISOString() : null,
            meetingId: m.id,
            meetingCode: m.code,
            meetingStatus: m.status,
            isOwner: m.ownerId === userId,
            isRecurringOccurrence: true,
          });
        }
      } else {
        events.push({
          id: m.id,
          kind: "MEETING",
          title: m.title,
          start: m.scheduledStart.toISOString(),
          end: m.scheduledEnd ? m.scheduledEnd.toISOString() : null,
          meetingId: m.id,
          meetingCode: m.code,
          meetingStatus: m.status,
          isOwner: m.ownerId === userId,
          isRecurringOccurrence: false,
        });
      }
    }

    for (const s of sessions) {
      events.push({
        id: s.id,
        kind: "CLASS",
        title: s.title ?? s.class.title,
        start: s.sessionDate.toISOString(),
        end: null,
        meetingId: s.meetingId,
        meetingCode: s.meeting.code,
        meetingStatus: s.meeting.status,
        isOwner: s.meeting.ownerId === userId,
        isRecurringOccurrence: false,
        classId: s.classId,
        className: s.class.title,
      });
    }

    events.sort((a, b) => a.start.localeCompare(b.start));
    return events;
  }
}

/** Projects a RECURRING meeting's single stored rule forward into the
 * individual occurrence dates that fall within `[from, to]`. Fast-forwards
 * past occurrences before `from` using arithmetic (for DAILY/WEEKLY) rather
 * than iterating one step at a time from `start`, since `start` can be
 * arbitrarily far in the past for a long-lived weekly meeting; MONTHLY steps
 * via `setMonth` one at a time to preserve day-of-month/DST correctness
 * instead of a fixed millisecond step. */
function expandRecurrence(
  start: Date,
  freq: RecurrenceFrequency,
  until: Date | null,
  from: Date,
  to: Date,
): Date[] {
  const effectiveEnd = until && until < to ? until : to;
  if (start > effectiveEnd) return [];

  let cursor = new Date(start);
  if (cursor < from) {
    if (freq === "DAILY" || freq === "WEEKLY") {
      const stepMs = (freq === "DAILY" ? 1 : 7) * 24 * 60 * 60 * 1000;
      const stepsNeeded = Math.floor((from.getTime() - cursor.getTime()) / stepMs);
      if (stepsNeeded > 0) cursor = new Date(cursor.getTime() + stepsNeeded * stepMs);
    } else {
      let guard = 0;
      while (cursor < from && guard < MAX_OCCURRENCES_PER_SERIES) {
        cursor.setMonth(cursor.getMonth() + 1);
        guard++;
      }
    }
  }

  const out: Date[] = [];
  let count = 0;
  while (cursor <= effectiveEnd && count < MAX_OCCURRENCES_PER_SERIES) {
    if (cursor >= from) out.push(new Date(cursor));
    if (freq === "DAILY") cursor.setDate(cursor.getDate() + 1);
    else if (freq === "WEEKLY") cursor.setDate(cursor.getDate() + 7);
    else cursor.setMonth(cursor.getMonth() + 1);
    count++;
  }
  return out;
}
