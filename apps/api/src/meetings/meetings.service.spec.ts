import { MeetingsService } from "./meetings.service";
import { WS_EVENTS } from "@arutech/types";
import type { PrismaService } from "../prisma/prisma.service";
import type { LiveKitService } from "../livekit/livekit.service";
import type { PermissionService } from "./permission.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import type { OrganizationsService } from "../organizations/organizations.service";
import type { ContactsService } from "../contacts/contacts.service";
import type { TokenService } from "../common/lib/tokens";
import type { MailService } from "../mail/mail.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { Env } from "@arutech/config";

const MEETING = {
  id: "meeting-1",
  code: "abc-def-ghi",
  ownerId: "owner-1",
  status: "LIVE",
  // Typed as the real nullable column, not narrowed to the literal `null` —
  // otherwise `makeService({ meeting: { passwordHash: "..." } })` (used to
  // set up an already-has-a-password fixture) wouldn't type-check.
  passwordHash: null as string | null,
  livekitRoomName: "room-1",
  deletedAt: null,
  title: "Test meeting",
  scheduledStart: null as Date | null,
  scheduledEnd: null as Date | null,
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
  existingUser?: { id: string; email: string; displayName: string } | null;
  existingParticipantForInvitee?: unknown;
  meetingInviteExisting?: unknown;
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
        // Overridden by `existingParticipantForInvitee` for
        // inviteByEmail's "already part of this meeting" check — every
        // join()-path test relies on the plain `null` default (no
        // pre-existing participant) and never sets that override.
        findFirst: jest.fn().mockResolvedValue(overrides?.existingParticipantForInvitee ?? null),
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
      classTeacher: { findUnique: jest.fn().mockResolvedValue(null) },
      classStudent: { findUnique: jest.fn().mockResolvedValue(null) },
      meetingEvent: { create: jest.fn().mockResolvedValue(undefined) },
      user: {
        findUnique: jest.fn().mockResolvedValue(overrides?.existingUser ?? null),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "owner-1", displayName: "Real Owner Name" }),
      },
      meetingInvite: {
        findFirst: jest.fn().mockResolvedValue(overrides?.meetingInviteExisting ?? null),
        findUnique: jest.fn().mockImplementation(({ where: { id } }) =>
          Promise.resolve(id === "invite-1" ? { id: "invite-1", meetingId: MEETING.id, status: "PENDING" } : null),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "invite-new", ...data })),
        update: jest.fn().mockImplementation(({ where: { id }, data }) => Promise.resolve({ id, ...data })),
      },
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
  const mail = {
    sendMeetingInvite: jest.fn().mockResolvedValue(undefined),
  } as unknown as MailService;
  const notifications = {
    create: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;
  const env = { WEB_URL: "https://app.test" } as unknown as Env;

  const service = new MeetingsService(
    prisma,
    liveKit,
    permissions,
    broadcast,
    organizations,
    contacts,
    tokens,
    mail,
    notifications,
    env,
  );
  return { service, prisma, liveKit, permissions, broadcast, organizations, contacts, tokens, mail, notifications };
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

    // The UI previously had no way to remove a password once set — only
    // ever replace one — because there was no way to distinguish "leave it"
    // from "clear it" through this endpoint. `password: null` is that
    // explicit clear signal now. Starts from a meeting that already has a
    // password set, so this actually exercises the set-to-unset transition
    // rather than a no-op on an already-null hash.
    it("clears the password when password is explicitly null", async () => {
      const { service, prisma } = makeService({ meeting: { passwordHash: "existing-hash" } });
      await service.updateSettings(MEETING.id, "owner-1", { ...BASE_DTO, password: null });
      const data = (prisma.client.meeting.update as jest.Mock).mock.calls[0][0].data;
      expect(data.passwordHash).toBeNull();
    });

    it("reports requiresPassword: false in its own response after clearing the password", async () => {
      const { service } = makeService({ meeting: { passwordHash: "existing-hash" } });
      const result = await service.updateSettings(MEETING.id, "owner-1", { ...BASE_DTO, password: null });
      expect(result.requiresPassword).toBe(false);
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

  describe("inviteByEmail", () => {
    it("requires the meeting.settings.update capability", async () => {
      const { service, permissions } = makeService();
      await service.inviteByEmail(MEETING.id, "user-1", "guest@example.com", "PARTICIPANT");
      expect(permissions.requireOwnerOrCapability).toHaveBeenCalledWith(
        MEETING.id,
        "user-1",
        "meeting.settings.update",
      );
    });

    it("creates a real MeetingInvite row with a token and an expiry", async () => {
      const { service, prisma } = makeService();
      await service.inviteByEmail(MEETING.id, "owner-1", "guest@example.com", "PARTICIPANT");
      const data = (prisma.client.meetingInvite.create as jest.Mock).mock.calls[0][0].data;
      expect(data.meetingId).toBe(MEETING.id);
      expect(data.email).toBe("guest@example.com");
      expect(data.role).toBe("PARTICIPANT");
      expect(data.invitedByUserId).toBe("owner-1");
      expect(typeof data.token).toBe("string");
      expect(data.token.length).toBeGreaterThan(10);
      expect(data.expiresAt).toBeInstanceOf(Date);
    });

    it("expires the invite at the meeting's own scheduled end time when it has one, not the flat fallback", async () => {
      const scheduledEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const { service, prisma } = makeService({ meeting: { scheduledEnd } });
      await service.inviteByEmail(MEETING.id, "owner-1", "guest@example.com", "PARTICIPANT");
      const data = (prisma.client.meetingInvite.create as jest.Mock).mock.calls[0][0].data;
      expect(data.expiresAt).toEqual(scheduledEnd);
    });

    it("sends a real invite email", async () => {
      const { service, mail } = makeService();
      await service.inviteByEmail(MEETING.id, "owner-1", "guest@example.com", "PARTICIPANT");
      expect(mail.sendMeetingInvite).toHaveBeenCalledWith(
        expect.objectContaining({ to: "guest@example.com", meetingTitle: MEETING.title }),
      );
    });

    it("refreshes an existing PENDING invite in place instead of creating a duplicate", async () => {
      const { service, prisma } = makeService({
        meetingInviteExisting: { id: "invite-existing", meetingId: MEETING.id, email: "guest@example.com" },
      });
      await service.inviteByEmail(MEETING.id, "owner-1", "guest@example.com", "CO_HOST");
      expect(prisma.client.meetingInvite.create).not.toHaveBeenCalled();
      expect(prisma.client.meetingInvite.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "invite-existing" },
          data: expect.objectContaining({ role: "CO_HOST" }),
        }),
      );
    });

    it("refuses to invite someone who's already part of the meeting", async () => {
      const { service } = makeService({
        existingUser: { id: "existing-1", email: "guest@example.com", displayName: "Existing Person" },
        existingParticipantForInvitee: { id: "participant-x", meetingId: MEETING.id, userId: "existing-1" },
      });
      await expect(
        service.inviteByEmail(MEETING.id, "owner-1", "guest@example.com", "PARTICIPANT"),
      ).rejects.toThrow("already part of this meeting");
    });

    it("notifies an existing account in-app, not just by email", async () => {
      const { service, notifications } = makeService({
        existingUser: { id: "existing-1", email: "guest@example.com", displayName: "Existing Person" },
      });
      await service.inviteByEmail(MEETING.id, "owner-1", "guest@example.com", "PARTICIPANT");
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "existing-1", type: "MEETING_INVITE" }),
      );
    });

    it("never sends an in-app notification for an email with no account", async () => {
      const { service, notifications } = makeService();
      await service.inviteByEmail(MEETING.id, "owner-1", "guest@example.com", "PARTICIPANT");
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it("still sends the email even if delivery throws — a real invite row already exists, that's not the caller's problem", async () => {
      const { service, mail } = makeService();
      (mail.sendMeetingInvite as jest.Mock).mockRejectedValueOnce(new Error("smtp down"));
      await expect(
        service.inviteByEmail(MEETING.id, "owner-1", "guest@example.com", "PARTICIPANT"),
      ).resolves.toBeDefined();
    });
  });

  describe("revokeInvite", () => {
    it("requires the meeting.settings.update capability", async () => {
      const { service, permissions } = makeService();
      await service.revokeInvite(MEETING.id, "user-1", "invite-1");
      expect(permissions.requireOwnerOrCapability).toHaveBeenCalledWith(
        MEETING.id,
        "user-1",
        "meeting.settings.update",
      );
    });

    it("marks a real invite REVOKED", async () => {
      const { service, prisma } = makeService();
      await service.revokeInvite(MEETING.id, "owner-1", "invite-1");
      expect(prisma.client.meetingInvite.update).toHaveBeenCalledWith({
        where: { id: "invite-1" },
        data: { status: "REVOKED" },
      });
    });

    it("refuses to revoke an invite that belongs to a different meeting", async () => {
      const { service } = makeService();
      await expect(service.revokeInvite("some-other-meeting", "owner-1", "invite-1")).rejects.toThrow(
        "Invite not found",
      );
    });

    it("404s for an invite id that doesn't exist at all", async () => {
      const { service } = makeService();
      await expect(service.revokeInvite(MEETING.id, "owner-1", "no-such-invite")).rejects.toThrow(
        "Invite not found",
      );
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

  // CS-2: the class-session TEACHER/STUDENT role lookup used to be gated on
  // `!isOwner`, so the teacher who actually started their own class session
  // — the single most common case — never reached it and stayed the
  // generic "HOST" default instead, while any OTHER teacher joining the
  // same session correctly got "TEACHER".
  describe("join — class session role", () => {
    it("assigns the meeting owner TEACHER, not the generic HOST default, when they're a teacher of the linked class", async () => {
      const { service, prisma } = makeService();
      (prisma.client.classSession.findUnique as jest.Mock).mockResolvedValue({
        id: "session-1",
        classId: "class-1",
        meetingId: MEETING.id,
      });
      (prisma.client.classTeacher.findUnique as jest.Mock).mockResolvedValue({
        classId: "class-1",
        userId: MEETING.ownerId,
      });

      const result = await service.join(MEETING.code, { userId: MEETING.ownerId, email: "owner@x.com" }, {});

      expect(result.role).toBe("TEACHER");
    });

    it("still assigns TEACHER to a non-owner co-teacher joining someone else's class session (no regression)", async () => {
      const { service, prisma } = makeService();
      (prisma.client.classSession.findUnique as jest.Mock).mockResolvedValue({
        id: "session-1",
        classId: "class-1",
        meetingId: MEETING.id,
      });
      (prisma.client.classTeacher.findUnique as jest.Mock).mockResolvedValue({
        classId: "class-1",
        userId: "co-teacher-1",
      });

      const result = await service.join(MEETING.code, { userId: "co-teacher-1", email: "coteacher@x.com" }, {});

      expect(result.role).toBe("TEACHER");
    });

    it("leaves a non-classroom meeting's owner as HOST (no linked class session at all)", async () => {
      const { service } = makeService();
      const result = await service.join(MEETING.code, { userId: MEETING.ownerId, email: "owner@x.com" }, {});
      expect(result.role).toBe("HOST");
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
