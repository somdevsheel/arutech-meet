import { SearchService } from "./search.service";
import type { PrismaService } from "../prisma/prisma.service";

function makePrisma(overrides?: Partial<Record<string, unknown[]>>) {
  const rows = {
    meeting: overrides?.meeting ?? [],
    note: overrides?.note ?? [],
    meetingParticipant: overrides?.meetingParticipant ?? [],
    chatMessage: overrides?.chatMessage ?? [],
    fileAsset: overrides?.fileAsset ?? [],
    meetingRecording: overrides?.meetingRecording ?? [],
    transcriptSegment: overrides?.transcriptSegment ?? [],
    course: overrides?.course ?? [],
    assignment: overrides?.assignment ?? [],
    class: overrides?.class ?? [],
  };
  const client: Record<string, unknown> = {};
  const calls: Record<string, unknown> = {};
  for (const [model, data] of Object.entries(rows)) {
    const fn = jest.fn().mockImplementation((args) => {
      calls[model] = args;
      return Promise.resolve(data);
    });
    client[model] = { findMany: fn };
  }
  const prisma = { client } as unknown as PrismaService;
  return { prisma, calls };
}

describe("SearchService", () => {
  it("returns every category empty for a too-short query, without touching the database", async () => {
    const { prisma } = makePrisma();
    const service = new SearchService(prisma);
    const results = await service.search("user-1", "a");
    expect(results).toEqual({
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
    });
    expect((prisma.client as unknown as { meeting: { findMany: jest.Mock } }).meeting.findMany).not.toHaveBeenCalled();
  });

  describe("chatMessages", () => {
    it("scopes to rooms the caller is actually a ChatMember of", async () => {
      const { prisma, calls } = makePrisma();
      await new SearchService(prisma).search("user-1", "hello");
      expect(calls.chatMessage).toEqual(
        expect.objectContaining({
          where: expect.objectContaining({ chatRoom: { members: { some: { userId: "user-1" } } } }),
        }),
      );
    });

    it("resolves a MEETING room's href to /meeting/:code", async () => {
      const { prisma } = makePrisma({
        chatMessage: [
          {
            id: "msg-1",
            body: "hello there",
            sender: { displayName: "Ada" },
            chatRoom: { id: "room-1", type: "MEETING", name: null, meetingId: "m1", classId: null, teamId: null, meeting: { code: "abc-def-ghi", title: "Standup" }, class: null, team: null },
          },
        ],
      });
      const { chatMessages } = await new SearchService(prisma).search("user-1", "hello");
      expect(chatMessages).toEqual([
        { id: "msg-1", body: "hello there", senderName: "Ada", roomLabel: "Standup", href: "/meeting/abc-def-ghi" },
      ]);
    });

    it("resolves a TEAM room's href to /teams/:id", async () => {
      const { prisma } = makePrisma({
        chatMessage: [
          {
            id: "msg-2",
            body: "team update",
            sender: { displayName: "Bo" },
            chatRoom: { id: "room-2", type: "TEAM", name: null, meetingId: null, classId: null, teamId: "team-1", meeting: null, class: null, team: { name: "Engineering" } },
          },
        ],
      });
      const { chatMessages } = await new SearchService(prisma).search("user-1", "team");
      expect(chatMessages[0]).toEqual(
        expect.objectContaining({ roomLabel: "Engineering", href: "/teams/team-1" }),
      );
    });

    it("resolves a GROUP room's href to /chat?room=:id, using the room's own name", async () => {
      const { prisma } = makePrisma({
        chatMessage: [
          {
            id: "msg-3",
            body: "hi all",
            sender: { displayName: "Cy" },
            chatRoom: { id: "room-3", type: "GROUP", name: "Design Crew", meetingId: null, classId: null, teamId: null, meeting: null, class: null, team: null },
          },
        ],
      });
      const { chatMessages } = await new SearchService(prisma).search("user-1", "hi");
      expect(chatMessages[0]).toEqual(
        expect.objectContaining({ roomLabel: "Design Crew", href: "/chat?room=room-3" }),
      );
    });
  });

  describe("files", () => {
    it("scopes to files the caller uploaded, or reached via a meeting/room/class they're actually part of", async () => {
      const { prisma, calls } = makePrisma();
      await new SearchService(prisma).search("user-1", "report");
      const where = (calls.fileAsset as { where: { OR: unknown[] } }).where;
      expect(where.OR).toEqual([
        { uploaderUserId: "user-1" },
        { meeting: { OR: [{ ownerId: "user-1" }, { participants: { some: { userId: "user-1" } } }] } },
        { chatRoom: { members: { some: { userId: "user-1" } } } },
        { class: { OR: [{ ownerTeacherId: "user-1" }, { teachers: { some: { userId: "user-1" } } }, { students: { some: { userId: "user-1" } } }] } },
      ]);
    });

    it("prefers the meeting context over class/chat room when a file has one", async () => {
      const { prisma } = makePrisma({
        fileAsset: [
          {
            id: "f1",
            originalName: "slides.pdf",
            meeting: { code: "xyz-123", title: "Kickoff" },
            class: { id: "c1", title: "Algebra" },
            chatRoom: null,
          },
        ],
      });
      const { files } = await new SearchService(prisma).search("user-1", "slides");
      expect(files[0]).toEqual({ id: "f1", originalName: "slides.pdf", contextLabel: "Kickoff", href: "/meeting/xyz-123" });
    });

    it("falls back to a null href for a file with no resolvable context", async () => {
      const { prisma } = makePrisma({
        fileAsset: [{ id: "f2", originalName: "orphan.pdf", meeting: null, class: null, chatRoom: null }],
      });
      const { files } = await new SearchService(prisma).search("user-1", "orphan");
      expect(files[0]).toEqual({ id: "f2", originalName: "orphan.pdf", contextLabel: "File", href: null });
    });
  });

  it("recordings: only READY ones, from a meeting the caller owned or attended", async () => {
    const { prisma, calls } = makePrisma();
    await new SearchService(prisma).search("user-1", "standup");
    expect(calls.meetingRecording).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "READY",
          meeting: expect.objectContaining({ OR: [{ ownerId: "user-1" }, { participants: { some: { userId: "user-1" } } }] }),
        }),
      }),
    );
  });

  it("transcriptSegments: cross-meeting, same ILIKE approach as the per-meeting search", async () => {
    const { prisma } = makePrisma({
      transcriptSegment: [
        { id: "seg-1", text: "let's discuss the roadmap", transcript: { meeting: { code: "aaa-bbb-ccc", title: "Planning" } } },
      ],
    });
    const { transcriptSegments } = await new SearchService(prisma).search("user-1", "roadmap");
    expect(transcriptSegments).toEqual([
      { id: "seg-1", text: "let's discuss the roadmap", meetingTitle: "Planning", href: "/meeting/aaa-bbb-ccc" },
    ]);
  });

  it("courses: same visibility CoursesService.listMine already defines", async () => {
    const { prisma, calls } = makePrisma();
    await new SearchService(prisma).search("user-1", "biology");
    expect(calls.course).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { createdById: "user-1" },
            { batches: { some: { teachers: { some: { userId: "user-1" } } } } },
            { batches: { some: { students: { some: { userId: "user-1" } } } } },
          ],
        }),
      }),
    );
  });

  it("assignments: scoped to classes the caller owns, teaches, or is enrolled in; links to the parent class", async () => {
    const { prisma } = makePrisma({
      assignment: [{ id: "a1", title: "Essay 1", class: { id: "c1", title: "English" } }],
    });
    const { assignments } = await new SearchService(prisma).search("user-1", "essay");
    expect(assignments).toEqual([{ id: "a1", title: "Essay 1", classTitle: "English", href: "/classes/c1" }]);
  });

  it("classes: matches on title or subject, same owner/teacher/student visibility", async () => {
    const { prisma, calls } = makePrisma({
      class: [{ id: "c2", title: "Intro to Physics", subject: "Physics" }],
    });
    const { classes } = await new SearchService(prisma).search("user-1", "physics");
    expect(classes).toEqual([{ id: "c2", title: "Intro to Physics", subject: "Physics", href: "/classes/c2" }]);
    expect(calls.class).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: { OR: [{ ownerTeacherId: "user-1" }, { teachers: { some: { userId: "user-1" } } }, { students: { some: { userId: "user-1" } } }] },
        }),
      }),
    );
  });
});
