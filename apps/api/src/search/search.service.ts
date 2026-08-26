import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface SearchResults {
  meetings: { id: string; code: string; title: string; status: string }[];
  contacts: { id: string; displayName: string; username: string; avatarUrl: string | null }[];
  notes: { id: string; title: string }[];
  chatMessages: { id: string; body: string; senderName: string; roomLabel: string; href: string }[];
  files: { id: string; originalName: string; contextLabel: string; href: string | null }[];
  recordings: { id: string; meetingTitle: string; href: string }[];
  transcriptSegments: { id: string; text: string; meetingTitle: string; href: string }[];
  courses: { id: string; title: string; href: string }[];
  assignments: { id: string; title: string; classTitle: string; href: string }[];
  classes: { id: string; title: string; subject: string | null; href: string }[];
}

/** Where a ChatRoom (or a file attached to one) actually opens — the same
 * type-to-route mapping a client would otherwise have to duplicate, resolved
 * once here so every new search category below can just reuse it. */
function chatRoomHref(room: { type: string; meetingId: string | null; classId: string | null; teamId: string | null; id: string; meeting?: { code: string } | null }) {
  if (room.type === "MEETING" && room.meeting) return `/meeting/${room.meeting.code}`;
  if (room.type === "CLASS" && room.classId) return `/classes/${room.classId}`;
  if (room.type === "TEAM" && room.teamId) return `/teams/${room.teamId}`;
  return `/chat?room=${room.id}`;
}

/** Backs the topbar search box. Started (Stage 11) as three scoped-to-the-
 * caller queries (meetings/notes/contacts); this stage adds six more —
 * chat messages, files, recordings, transcripts, courses, assignments/
 * classes — each its own independently-scoped, additive query, not a
 * rearchitecture. Every branch reuses this codebase's existing "does this
 * caller actually have access" definition for that model rather than
 * inventing a new one: chat via `ChatMember`, files via
 * uploader/meeting/room/class involvement, recordings/transcripts via
 * `RecordingsService.listMine`'s meeting-involvement check, courses via
 * `CoursesService.listMine`'s definition, classes/assignments via
 * `ClassTeacher`/`ClassStudent`. Never a cross-user search. */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(userId: string, query: string): Promise<SearchResults> {
    const q = query.trim();
    if (q.length < 2) {
      return {
        meetings: [],
        contacts: [],
        notes: [],
        chatMessages: [],
        files: [],
        recordings: [],
        transcriptSegments: [],
        courses: [],
        assignments: [],
        classes: [],
      };
    }
    const ci = { contains: q, mode: "insensitive" as const };

    const [
      meetings,
      notes,
      coParticipants,
      chatMessageRows,
      fileRows,
      recordingRows,
      transcriptRows,
      courseRows,
      assignmentRows,
      classRows,
    ] = await Promise.all([
      this.prisma.client.meeting.findMany({
        where: {
          deletedAt: null,
          OR: [{ ownerId: userId }, { participants: { some: { userId } } }],
          AND: { OR: [{ title: ci }, { code: ci }] },
        },
        select: { id: true, code: true, title: true, status: true },
        take: 8,
      }),
      this.prisma.client.note.findMany({
        where: { userId, deletedAt: null, title: ci },
        select: { id: true, title: true },
        take: 8,
      }),
      // Same "co-participant" definition ContactsService uses, filtered by name/username/email.
      this.prisma.client.meetingParticipant.findMany({
        where: {
          userId: { not: userId },
          status: { in: ["JOINED", "LEFT"] },
          meeting: { participants: { some: { userId, status: { in: ["JOINED", "LEFT"] } } } },
          user: { OR: [{ displayName: ci }, { username: ci }, { email: ci }] },
        },
        include: { user: { select: { id: true, displayName: true, username: true, avatarUrl: true } } },
        take: 20,
      }),
      this.prisma.client.chatMessage.findMany({
        where: { deletedAt: null, body: ci, chatRoom: { members: { some: { userId } } } },
        include: {
          sender: { select: { displayName: true } },
          chatRoom: {
            select: {
              id: true,
              type: true,
              name: true,
              meetingId: true,
              classId: true,
              teamId: true,
              meeting: { select: { code: true, title: true } },
              class: { select: { title: true } },
              team: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      this.prisma.client.fileAsset.findMany({
        where: {
          deletedAt: null,
          originalName: ci,
          OR: [
            { uploaderUserId: userId },
            { meeting: { OR: [{ ownerId: userId }, { participants: { some: { userId } } }] } },
            { chatRoom: { members: { some: { userId } } } },
            { class: { OR: [{ ownerTeacherId: userId }, { teachers: { some: { userId } } }, { students: { some: { userId } } }] } },
          ],
        },
        include: {
          meeting: { select: { code: true, title: true } },
          class: { select: { id: true, title: true } },
          chatRoom: {
            select: {
              id: true,
              type: true,
              name: true,
              meetingId: true,
              classId: true,
              teamId: true,
              meeting: { select: { code: true } },
            },
          },
        },
        take: 6,
      }),
      // Same scoping RecordingsService.listMine uses for its "Recent
      // recordings" card — every READY recording from a meeting the caller
      // owned or attended — filtered here by the parent meeting's title
      // (a MeetingRecording has no free-text field of its own to match on).
      this.prisma.client.meetingRecording.findMany({
        where: {
          deletedAt: null,
          status: "READY",
          meeting: { deletedAt: null, title: ci, OR: [{ ownerId: userId }, { participants: { some: { userId } } }] },
        },
        include: { meeting: { select: { code: true, title: true } } },
        take: 6,
      }),
      // Cross-meeting version of TranscriptsService.search — same ILIKE
      // approach, no longer scoped to one meeting.
      this.prisma.client.transcriptSegment.findMany({
        where: {
          text: ci,
          transcript: { meeting: { deletedAt: null, OR: [{ ownerId: userId }, { participants: { some: { userId } } }] } },
        },
        include: { transcript: { select: { meeting: { select: { code: true, title: true } } } } },
        take: 6,
      }),
      // Same visibility CoursesService.listMine already defines.
      this.prisma.client.course.findMany({
        where: {
          deletedAt: null,
          title: ci,
          OR: [
            { createdById: userId },
            { batches: { some: { teachers: { some: { userId } } } } },
            { batches: { some: { students: { some: { userId } } } } },
          ],
        },
        select: { id: true, title: true },
        take: 6,
      }),
      this.prisma.client.assignment.findMany({
        where: {
          deletedAt: null,
          title: ci,
          class: { OR: [{ ownerTeacherId: userId }, { teachers: { some: { userId } } }, { students: { some: { userId } } }] },
        },
        include: { class: { select: { id: true, title: true } } },
        take: 6,
      }),
      this.prisma.client.class.findMany({
        where: {
          deletedAt: null,
          OR: [{ title: ci }, { subject: ci }],
          AND: { OR: [{ ownerTeacherId: userId }, { teachers: { some: { userId } } }, { students: { some: { userId } } }] },
        },
        select: { id: true, title: true, subject: true },
        take: 6,
      }),
    ]);

    const contactsById = new Map<string, SearchResults["contacts"][number]>();
    for (const p of coParticipants) {
      if (p.user && !contactsById.has(p.user.id)) contactsById.set(p.user.id, p.user);
    }

    const chatMessages = chatMessageRows.map((m) => {
      const room = m.chatRoom;
      const roomLabel =
        room.type === "MEETING"
          ? room.meeting?.title ?? "Meeting chat"
          : room.type === "CLASS"
            ? room.class?.title ?? "Class chat"
            : room.type === "TEAM"
              ? room.team?.name ?? "Team chat"
              : room.name ?? "Chat";
      return {
        id: m.id,
        body: m.body ?? "",
        senderName: m.sender?.displayName ?? "Someone",
        roomLabel,
        href: chatRoomHref(room),
      };
    });

    const files = fileRows.map((f) => {
      let contextLabel = "File";
      let href: string | null = null;
      if (f.meeting) {
        contextLabel = f.meeting.title;
        href = `/meeting/${f.meeting.code}`;
      } else if (f.class) {
        contextLabel = f.class.title;
        href = `/classes/${f.class.id}`;
      } else if (f.chatRoom) {
        contextLabel = "Chat";
        href = chatRoomHref(f.chatRoom);
      }
      return { id: f.id, originalName: f.originalName, contextLabel, href };
    });

    const recordings = recordingRows.map((r) => ({
      id: r.id,
      meetingTitle: r.meeting.title,
      href: "/recordings",
    }));

    const transcriptSegments = transcriptRows.map((t) => ({
      id: t.id,
      text: t.text,
      meetingTitle: t.transcript.meeting.title,
      href: `/meeting/${t.transcript.meeting.code}`,
    }));

    const courses = courseRows.map((c) => ({ id: c.id, title: c.title, href: `/courses/${c.id}` }));

    const assignments = assignmentRows.map((a) => ({
      id: a.id,
      title: a.title,
      classTitle: a.class.title,
      href: `/classes/${a.class.id}`,
    }));

    const classes = classRows.map((c) => ({ id: c.id, title: c.title, subject: c.subject, href: `/classes/${c.id}` }));

    return {
      meetings,
      notes,
      contacts: [...contactsById.values()].slice(0, 8),
      chatMessages,
      files,
      recordings,
      transcriptSegments,
      courses,
      assignments,
      classes,
    };
  }
}
