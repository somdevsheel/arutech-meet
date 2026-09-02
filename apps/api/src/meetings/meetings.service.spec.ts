import { MeetingsService } from "./meetings.service";
import { WS_EVENTS } from "@arutech/types";
import type { PrismaService } from "../prisma/prisma.service";
import type { LiveKitService } from "../livekit/livekit.service";
import type { PermissionService } from "./permission.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import type { OrganizationsService } from "../organizations/organizations.service";
import type { ContactsService } from "../contacts/contacts.service";
import type { TokenService } from "../common/lib/tokens";

const MEETING = {
  id: "meeting-1",
  code: "abc-def-ghi",
  ownerId: "owner-1",
  status: "LIVE",
  passwordHash: null,
  livekitRoomName: "room-1",
  deletedAt: null,
  // waitingRoomEnabled: true keeps a successful non-owner join in WAITING
  // status, which skips LiveKit token issuance entirely — lets these tests
  // exercise the real domain/block checks without mocking the whole LiveKit
  // client just to reach a status these tests don't care about.
  settings: { waitingRoomEnabled: true, lockAfterStart: false, allowedEmailDomains: [] as string[] },
};

function makeService(overrides?: {
  meeting?: Partial<Omit<typeof MEETING, "settings">> & { settings?: Partial<typeof MEETING.settings> };
  hasBlocked?: boolean;
  listMineResult?: unknown[];
  personalRoomExisting?: unknown;
}) {
  const meeting = { ...MEETING, ...overrides?.meeting, settings: { ...MEETING.settings, ...overrides?.meeting?.settings } };
  const prisma = {
    client: {
      meeting: {
        findUnique: jest.fn().mockResolvedValue(meeting),
        findFirst: jest.fn().mockResolvedValue(overrides?.personalRoomExisting ?? null),
        findMany: jest.fn().mockResolvedValue(overrides?.listMineResult ?? [meeting]),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...meeting, ...data, status: data.status ?? "ENDED" })),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...meeting, ...data, code: "abc-def-ghi" })),
      },
      membership: {
        findUnique: jest.fn().mockResolvedValue({ orgId: "org-1", userId: "user-1", role: "MEMBER" }),
      },
      meetingParticipant: {
        findFirst: jest.fn().mockResolvedValue(null),
        // join()'s own create/update return is reused by issueToken's
        // subsequent findUnique lookup (admitAndIssueToken -> issueToken) —
        // both need `status: ADMITTED` for a real ("HOST") joiner to pass
        // issueToken's own status check.
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "participant-1", ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "participant-1", ...data })),
        // join()'s upsert path for a real (non-guest) caller — these tests'
        // findFirst mock always returns null (no pre-existing participant),
        // so mimic create()'s shape here too: the mock doesn't model actual
        // upsert conflict semantics, just returns what a fresh create would.
        upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: "participant-1", ...create })),
        findUnique: jest.fn().mockResolvedValue({
          id: "participant-1",
          meetingId: MEETING.id,
          role: "HOST",
          status: "ADMITTED",
          livekitIdentity: "owner-1-abc",
          guestName: null,
          userId: MEETING.ownerId,
          user: { displayName: "Real Owner Name" },
        }),
      },
      classSession: { findUnique: jest.fn().mockResolvedValue(null) },
      meetingEvent: { create: jest.fn().mockResolvedValue(undefined) },
    },
  } as unknown as PrismaService;
  const liveKit = {
    endRoom: jest.fn().mockResolvedValue(undefined),
    ensureRoom: jest.fn().mockResolvedValue(undefined),
    createRoomToken: jest.fn().mockResolvedValue("token"),
    getClientUrl: jest.fn().mockReturnValue("wss://livekit.test"),
  } as unknown as LiveKitService;
  const permissions = {
    requireOwnerOrCapability: jest.fn().mockResolvedValue(undefined),
  } as unknown as PermissionService;
  const broadcast = { publish: jest.fn().mockResolvedValue(undefined) } as unknown as RealtimeBroadcastService;
  const organizations = {
    assertMeetingConcurrencyOk: jest.fn().mockResolvedValue(undefined),
  } as unknown as OrganizationsService;
  const contacts = {
    hasBlocked: jest.fn().mockResolvedValue(overrides?.hasBlocked ?? false),
  } as unknown as ContactsService;
  const tokens = {
    signGuestToken: jest.fn().mockReturnValue("guest-token"),
  } as unknown as TokenService;

  const service = new MeetingsService(prisma, liveKit, permissions, broadcast, organizations, contacts, tokens);
  return { service, prisma, liveKit, permissions, broadcast, organizations, contacts, tokens };
}

const BASE_DTO = { title: "Test meeting", type: "INSTANT" as const, timezone: "UTC" };

describe("MeetingsService", () => {
  describe("create", () => {
    it("checks the org's meeting-concurrency limit when creating a meeting under an org", async () => {
      const { service, organizations } = makeService();
      await service.create("user-1", { ...BASE_DTO, orgId: "org-1" });
      expect(organizations.assertMeetingConcurrencyOk).toHaveBeenCalledWith("org-1");
    });

    it("never checks the limit for a personal (non-org) meeting", async () => {
      const { service, organizations, prisma } = makeService();
      (prisma.client.membership.findUnique as jest.Mock).mockResolvedValue(null);
      await service.create("user-1", BASE_DTO);
      expect(organizations.assertMeetingConcurrencyOk).not.toHaveBeenCalled();
    });

    // H-11's actual bug was "no UI to set one", but fixing that required
    // knowing whether a password is currently set without ever sending the
    // hash itself to the client — every meeting object returned from an
    // authenticated endpoint must go through sanitizeMeeting.
    it("never returns the password hash, and reports requiresPassword: true when one is set", async () => {
      const { service } = makeService();
      const result = await service.create("user-1", { ...BASE_DTO, password: "secret123" });
      expect(result).not.toHaveProperty("passwordHash");
      expect(result.requiresPassword).toBe(true);
    });

    it("reports requiresPassword: false when no password is set", async () => {
      const { service } = makeService();
      const result = await service.create("user-1", BASE_DTO);
      expect(result).not.toHaveProperty("passwordHash");
      expect(result.requiresPassword).toBe(false);
    });

    it("propagates a concurrency-limit rejection instead of creating the meeting", async () => {
      const { service, organizations, prisma } = makeService();
      (organizations.assertMeetingConcurrencyOk as jest.Mock).mockRejectedValue(new Error("limit reached"));
      await expect(service.create("user-1", { ...BASE_DTO, orgId: "org-1" })).rejects.toThrow("limit reached");
      expect(prisma.client.meeting.create).not.toHaveBeenCalled();
    });
  });

  describe("end", () => {
    it("requires the meeting.end capability", async () => {
      const { service, permissions } = makeService();
      await service.end(MEETING.id, "user-1");
      expect(permissions.requireOwnerOrCapability).toHaveBeenCalledWith(MEETING.id, "user-1", "meeting.end");
    });

    it("marks the meeting ENDED", async () => {
      const { service, prisma } = makeService();
      await service.end(MEETING.id, "user-1");
      expect(prisma.client.meeting.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: MEETING.id },
          data: expect.objectContaining({ status: "ENDED" }),
        }),
      );
    });

    // Regression test: hosts had no way to end a meeting for everyone from
    // the UI, and the client's already-wired MEETING_ENDED listener
    // (use-meeting-socket.ts) never actually fired because this broadcast
    // was missing entirely — see docs/roadmap.md's write-up.
    it("broadcasts MEETING_ENDED to the meeting room before closing LiveKit", async () => {
      const { service, broadcast, liveKit } = makeService();
      const calls: string[] = [];
      (broadcast.publish as jest.Mock).mockImplementation(() => {
        calls.push("broadcast");
        return Promise.resolve();
      });
      (liveKit.endRoom as jest.Mock).mockImplementation(() => {
        calls.push("endRoom");
        return Promise.resolve();
      });

      await service.end(MEETING.id, "user-1");

      expect(broadcast.publish).toHaveBeenCalledWith(MEETING.id, WS_EVENTS.MEETING_ENDED, {});
      expect(liveKit.endRoom).toHaveBeenCalledWith(MEETING.livekitRoomName);
      expect(calls).toEqual(["broadcast", "endRoom"]);
    });
  });

  // Regression tests: this endpoint's dto validates every field
  // createMeetingSchema does (it's `.partial()` of it), but the Prisma
  // update used to only ever write title/scheduledStart/scheduledEnd/
  // settings — password, timezone, and recurrence fields were silently
  // discarded despite the endpoint returning 200. Worst case: rotating a
  // leaked meeting password did nothing.
  describe("updateSettings", () => {
    it("re-hashes and writes a new password when one is provided", async () => {
      const { service, prisma } = makeService();
      await service.updateSettings(MEETING.id, "owner-1", { ...BASE_DTO, password: "newSecret1" });
      const data = (prisma.client.meeting.update as jest.Mock).mock.calls[0][0].data;
      expect(data.passwordHash).toEqual(expect.any(String));
      expect(data.passwordHash).not.toBe("newSecret1");
    });

    it("leaves the password untouched when none is provided", async () => {
      const { service, prisma } = makeService();
      await service.updateSettings(MEETING.id, "owner-1", BASE_DTO);
      const data = (prisma.client.meeting.update as jest.Mock).mock.calls[0][0].data;
      expect(data.passwordHash).toBeUndefined();
    });

    it("never returns the password hash in its own response either", async () => {
      const { service } = makeService();
      const result = await service.updateSettings(MEETING.id, "owner-1", {
        ...BASE_DTO,
        password: "newSecret1",
      });
      expect(result).not.toHaveProperty("passwordHash");
      expect(result.requiresPassword).toBe(true);
    });

    it("writes timezone and recurrence fields through to the update", async () => {
      const { service, prisma } = makeService();
      await service.updateSettings(MEETING.id, "owner-1", {
        ...BASE_DTO,
        timezone: "Asia/Kolkata",
        recurrenceFrequency: "WEEKLY",
        recurrenceUntil: "2027-01-01T00:00:00.000Z",
      });
      const data = (prisma.client.meeting.update as jest.Mock).mock.calls[0][0].data;
      expect(data.timezone).toBe("Asia/Kolkata");
      expect(data.recurrenceFrequency).toBe("WEEKLY");
      expect(data.recurrenceUntil).toEqual(new Date("2027-01-01T00:00:00.000Z"));
    });

    it("requires the meeting.settings.update capability", async () => {
      const { service, permissions } = makeService();
      await service.updateSettings(MEETING.id, "user-1", BASE_DTO);
      expect(permissions.requireOwnerOrCapability).toHaveBeenCalledWith(
        MEETING.id,
        "user-1",
        "meeting.settings.update",
      );
    });

    it("never writes type or orgId — those stay creation-time-only", async () => {
      const { service, prisma } = makeService();
      await service.updateSettings(MEETING.id, "owner-1", {
        ...BASE_DTO,
        type: "RECURRING",
        orgId: "org-2",
      });
      const data = (prisma.client.meeting.update as jest.Mock).mock.calls[0][0].data;
      expect(data).not.toHaveProperty("type");
      expect(data).not.toHaveProperty("orgId");
    });
  });

  describe("listMine", () => {
    it("strips the password hash from every meeting in the list", async () => {
      const { service, prisma } = makeService({
        listMineResult: [
          { ...MEETING, id: "meeting-a", passwordHash: "hash-a" },
          { ...MEETING, id: "meeting-b", passwordHash: null },
        ],
      });
      const result = await service.listMine("user-1");
      expect(prisma.client.meeting.findMany).toHaveBeenCalled();
      expect(result.every((m) => !("passwordHash" in m))).toBe(true);
      expect(result.find((m) => m.id === "meeting-a")?.requiresPassword).toBe(true);
      expect(result.find((m) => m.id === "meeting-b")?.requiresPassword).toBe(false);
    });
  });

  describe("join — domain restriction", () => {
    it("refuses a non-owner joiner whose email domain isn't allow-listed", async () => {
      const { service } = makeService({ meeting: { settings: { allowedEmailDomains: ["acme.com"] } } });
      await expect(
        service.join(MEETING.code, { userId: "user-2", email: "person@other.com" }, {}),
      ).rejects.toThrow("restricted to specific email domains");
    });

    it("refuses a guest outright once any domain is allow-listed — nothing to check against", async () => {
      const { service } = makeService({ meeting: { settings: { allowedEmailDomains: ["acme.com"] } } });
      await expect(service.join(MEETING.code, { guestName: "Guest" }, {})).rejects.toThrow(
        "restricted to specific email domains",
      );
    });

    it("admits a non-owner joiner whose email domain is allow-listed", async () => {
      const { service } = makeService({ meeting: { settings: { allowedEmailDomains: ["acme.com"] } } });
      const result = await service.join(MEETING.code, { userId: "user-2", email: "person@acme.com" }, {});
      expect(result.status).toBe("WAITING");
    });

    it("exempts the meeting owner from the domain restriction entirely", async () => {
      const { service } = makeService({ meeting: { settings: { allowedEmailDomains: ["acme.com"] } } });
      const result = await service.join(MEETING.code, { userId: MEETING.ownerId, email: "owner@elsewhere.com" }, {});
      expect(result.status).toBe("ADMITTED"); // the host is never sent to the waiting room
    });

    it("does nothing when the allow-list is empty (the default)", async () => {
      const { service } = makeService();
      const result = await service.join(MEETING.code, { userId: "user-2", email: "anyone@anywhere.com" }, {});
      expect(result.status).toBe("WAITING");
    });
  });

  describe("join — block", () => {
    it("refuses a joiner the meeting owner has blocked", async () => {
      const { service, contacts } = makeService({ hasBlocked: true });
      await expect(service.join(MEETING.code, { userId: "user-2", email: "a@b.com" }, {})).rejects.toThrow(
        "not able to join this meeting",
      );
      expect(contacts.hasBlocked).toHaveBeenCalledWith(MEETING.ownerId, "user-2");
    });

    it("never checks (or refuses) the owner joining their own meeting", async () => {
      const { service, contacts } = makeService({ hasBlocked: true });
      const result = await service.join(MEETING.code, { userId: MEETING.ownerId, email: "owner@x.com" }, {});
      expect(result.status).toBe("ADMITTED");
      expect(contacts.hasBlocked).not.toHaveBeenCalled();
    });

    it("admits a joiner the owner hasn't blocked", async () => {
      const { service } = makeService({ hasBlocked: false });
      const result = await service.join(MEETING.code, { userId: "user-2", email: "a@b.com" }, {});
      expect(result.status).toBe("WAITING");
    });
  });

  // Regression coverage: the write that resolves a real (non-guest) join
  // used to be a separate findFirst-then-branch (update if found, create if
  // not) with no transaction — two overlapping joins from the same user
  // could both read "no existing row" and both create, leaving duplicate
  // participant rows for one (meetingId, userId) pair. That pair is now a
  // DB-level unique constraint (see the migration), and the write itself is
  // a single atomic upsert.
  describe("join — concurrency", () => {
    it("upserts on the meetingId_userId unique key for a real (non-guest) joiner", async () => {
      const { service, prisma } = makeService();
      await service.join(MEETING.code, { userId: "user-2", email: "a@b.com" }, {});
      expect(prisma.client.meetingParticipant.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { meetingId_userId: { meetingId: MEETING.id, userId: "user-2" } },
        }),
      );
      expect(prisma.client.meetingParticipant.create).not.toHaveBeenCalled();
    });

    it("still uses a plain create for a guest — there's no meetingId_userId key to upsert on", async () => {
      const { service, prisma } = makeService();
      await service.join(MEETING.code, { guestName: "Guest" }, {});
      expect(prisma.client.meetingParticipant.create).toHaveBeenCalled();
      expect(prisma.client.meetingParticipant.upsert).not.toHaveBeenCalled();
    });

    it("upsert's update branch never touches role — a reconnecting co-host isn't silently reset", async () => {
      const { service, prisma } = makeService();
      await service.join(MEETING.code, { userId: "user-2", email: "a@b.com" }, {});
      const call = (prisma.client.meetingParticipant.upsert as jest.Mock).mock.calls[0][0];
      expect(call.update).not.toHaveProperty("role");
    });
  });

  // Regression coverage: join()'s existing-participant write used to
  // unconditionally reset status to WAITING/ADMITTED with no regard for what
  // it already was — a denied or removed participant could undo either just
  // by reloading the page. See git history for the finding.
  describe("join — denied/removed can't rejoin by reconnecting", () => {
    it("refuses a rejoin attempt from a participant the host denied", async () => {
      const { service, prisma } = makeService();
      (prisma.client.meetingParticipant.findFirst as jest.Mock).mockResolvedValue({
        role: "PARTICIPANT",
        status: "DENIED",
        livekitIdentity: "user-2-abc",
      });
      await expect(service.join(MEETING.code, { userId: "user-2", email: "a@b.com" }, {})).rejects.toThrow(
        "denied entry",
      );
      expect(prisma.client.meetingParticipant.upsert).not.toHaveBeenCalled();
    });

    it("refuses a rejoin attempt from a participant the host removed", async () => {
      const { service, prisma } = makeService();
      (prisma.client.meetingParticipant.findFirst as jest.Mock).mockResolvedValue({
        role: "PARTICIPANT",
        status: "REMOVED",
        livekitIdentity: "user-2-abc",
      });
      await expect(service.join(MEETING.code, { userId: "user-2", email: "a@b.com" }, {})).rejects.toThrow(
        "removed from this meeting",
      );
      expect(prisma.client.meetingParticipant.upsert).not.toHaveBeenCalled();
    });

    it("still lets a normal ADMITTED/JOINED participant reconnect", async () => {
      const { service, prisma } = makeService();
      (prisma.client.meetingParticipant.findFirst as jest.Mock).mockResolvedValue({
        role: "PARTICIPANT",
        status: "JOINED",
        livekitIdentity: "user-2-abc",
      });
      await expect(service.join(MEETING.code, { userId: "user-2", email: "a@b.com" }, {})).resolves.toBeDefined();
      expect(prisma.client.meetingParticipant.upsert).toHaveBeenCalled();
    });

    it("exempts the meeting owner from this check entirely", async () => {
      const { service, prisma } = makeService();
      (prisma.client.meetingParticipant.findFirst as jest.Mock).mockResolvedValue({
        role: "HOST",
        status: "DENIED",
        livekitIdentity: "owner-1-abc",
      });
      const result = await service.join(MEETING.code, { userId: MEETING.ownerId, email: "owner@x.com" }, {});
      expect(result.status).toBe("ADMITTED");
    });
  });

  // A guest has no access token at all, only a short-lived meeting-scoped
  // guest token (see TokenService.GuestTokenPayload) — this is what lets
  // their app-level socket connection and REST calls (chat, whiteboard,
  // polls...) work at all. `guestParticipantId` is how a returning guest
  // (a reload) is recognized as the SAME guest instead of always starting a
  // fresh WAITING row — see joinMeetingSchema's doc comment.
  describe("join — guest identity", () => {
    it("mints and returns a guest token for a guest join", async () => {
      const { service, tokens } = makeService();
      const result = await service.join(MEETING.code, { guestName: "Guest" }, {});
      expect(result.guestToken).toBe("guest-token");
      expect(tokens.signGuestToken).toHaveBeenCalledWith(
        expect.objectContaining({ meetingId: MEETING.id, kind: "guest" }),
      );
    });

    it("never mints a guest token for an authenticated join", async () => {
      const { service, tokens } = makeService();
      const result = await service.join(MEETING.code, { userId: "user-2", email: "a@b.com" }, {});
      expect(result.guestToken).toBeNull();
      expect(tokens.signGuestToken).not.toHaveBeenCalled();
    });

    it("recognizes a returning guest via guestParticipantId and UPDATEs their existing row instead of creating a new one", async () => {
      const { service, prisma } = makeService();
      (prisma.client.meetingParticipant.findFirst as jest.Mock).mockResolvedValue({
        id: "guest-participant-1",
        role: "GUEST",
        status: "WAITING",
        userId: null,
        livekitIdentity: "guest-abc",
      });
      await service.join(
        MEETING.code,
        { guestName: "Guest", guestParticipantId: "guest-participant-1" },
        {},
      );
      expect(prisma.client.meetingParticipant.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "guest-participant-1" } }),
      );
      expect(prisma.client.meetingParticipant.create).not.toHaveBeenCalled();
    });

    it("refuses a returning guest the host denied, the same as an authenticated user", async () => {
      const { service, prisma } = makeService();
      (prisma.client.meetingParticipant.findFirst as jest.Mock).mockResolvedValue({
        id: "guest-participant-1",
        role: "GUEST",
        status: "DENIED",
        userId: null,
        livekitIdentity: "guest-abc",
      });
      await expect(
        service.join(
          MEETING.code,
          { guestName: "Guest", guestParticipantId: "guest-participant-1" },
          {},
        ),
      ).rejects.toThrow("denied entry");
      expect(prisma.client.meetingParticipant.update).not.toHaveBeenCalled();
    });

    it("still does a plain create for a first-time guest with no guestParticipantId", async () => {
      const { service, prisma } = makeService();
      await service.join(MEETING.code, { guestName: "Guest" }, {});
      expect(prisma.client.meetingParticipant.create).toHaveBeenCalled();
      expect(prisma.client.meetingParticipant.update).not.toHaveBeenCalled();
    });
  });
});

// A guest reissuing their own LiveKit token (e.g. right after being
// admitted) has no User.id to match against — `callerUserId` here is their
// own MeetingParticipant.id (see JwtAuthGuard). Comparing only against
// `participant.userId` would always read as "not the same person" for a
// guest (null !== their id) and wrongly demand the moderator-only
// participant.role.promote_co_host capability just to fetch their own token.
describe("MeetingsService.issueTokenForCaller", () => {
  it("lets a guest reissue their own token without any moderator capability check", async () => {
    const { service, prisma, liveKit, permissions } = makeService();
    (prisma.client.meetingParticipant.findUnique as jest.Mock).mockResolvedValue({
      id: "guest-participant-1",
      meetingId: MEETING.id,
      userId: null,
      guestName: "Guest",
      role: "GUEST",
      status: "ADMITTED",
      livekitIdentity: "guest-abc",
    });

    await service.issueTokenForCaller(MEETING.id, "guest-participant-1", "guest-participant-1");

    expect(permissions.requireOwnerOrCapability).not.toHaveBeenCalled();
    expect(liveKit.createRoomToken).toHaveBeenCalled();
  });

  it("still requires participant.role.promote_co_host to fetch someone ELSE's token", async () => {
    const { service, prisma, permissions } = makeService();
    (prisma.client.meetingParticipant.findUnique as jest.Mock).mockResolvedValue({
      id: "participant-1",
      meetingId: MEETING.id,
      userId: "user-2",
      guestName: null,
      role: "PARTICIPANT",
      status: "ADMITTED",
      livekitIdentity: "user-2-abc",
      user: { displayName: "User Two" },
    });

    await service.issueTokenForCaller(MEETING.id, "participant-1", "host-1");

    expect(permissions.requireOwnerOrCapability).toHaveBeenCalledWith(
      MEETING.id,
      "host-1",
      "participant.role.promote_co_host",
    );
  });
});

// H-2: every authenticated participant's video tile showed their raw
// User.id UUID instead of their name — createRoomToken's `name` fell
// through `guestName ?? participant.userId ?? "Guest"` for anyone with a
// real account (guestName is always null for them), landing on the id.
describe("MeetingsService.issueToken", () => {
  it("uses the account's real display name for an authenticated participant's LiveKit token", async () => {
    const { service, liveKit, prisma } = makeService();
    (prisma.client.meetingParticipant.findUnique as jest.Mock).mockResolvedValue({
      id: "participant-1",
      meetingId: MEETING.id,
      role: "PARTICIPANT",
      status: "ADMITTED",
      livekitIdentity: "user-2-abc",
      guestName: null,
      userId: "user-2",
      user: { displayName: "Jamie Real Name" },
    });

    await service.issueToken(MEETING.id, "participant-1");

    expect(liveKit.createRoomToken).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Jamie Real Name" }),
    );
  });

  it("still uses guestName for a guest, never the display-name fallback", async () => {
    const { service, liveKit, prisma } = makeService();
    (prisma.client.meetingParticipant.findUnique as jest.Mock).mockResolvedValue({
      id: "guest-participant-1",
      meetingId: MEETING.id,
      role: "GUEST",
      status: "ADMITTED",
      livekitIdentity: "guest-abc",
      guestName: "Casual Visitor",
      userId: null,
      user: null,
    });

    await service.issueToken(MEETING.id, "guest-participant-1");

    expect(liveKit.createRoomToken).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Casual Visitor" }),
    );
  });
});
