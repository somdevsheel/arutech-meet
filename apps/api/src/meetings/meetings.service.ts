import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { nanoid } from "nanoid";
import type { Env } from "@arutech/config";
import { WS_EVENTS, type ParticipantRole } from "@arutech/types";
import type { CreateMeetingDto, JoinMeetingDto, UpdateMeetingDto } from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitService } from "../livekit/livekit.service";
import { PermissionService } from "./permission.service";
import { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import { generateLiveKitRoomName, generateMeetingCode } from "../common/lib/meeting-code";
import { OrganizationsService } from "../organizations/organizations.service";
import { ContactsService } from "../contacts/contacts.service";
import { TokenService } from "../common/lib/tokens";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";

export interface JoinResult {
  participantId: string;
  role: ParticipantRole;
  status: "WAITING" | "ADMITTED";
  meeting: { id: string; code: string; title: string; livekitRoomName: string };
  livekitUrl: string | null;
  livekitToken: string | null;
  /** Only ever set for a guest (no userId) — authenticates their app-level
   * realtime socket and REST calls for this one meeting, exactly like a
   * real accessToken does for an authenticated user. See
   * TokenService.GuestTokenPayload for why this can't just BE an
   * accessToken. Present regardless of WAITING/ADMITTED status: a waiting
   * guest still needs a working socket to ever receive the admit/deny
   * decision at all. */
  guestToken: string | null;
  /** Whether this participant's LiveKit token was actually granted the
   * screen-share publish source at issuance — the client can't tell this
   * from `role` alone (see `computeCanShareScreen`'s own comment: it also
   * depends on the meeting's `screenShareScope` setting). Lets the web
   * client seed its "Share screen" vs. "Request to share screen" toolbar
   * state correctly from the very first render, rather than defaulting to
   * one and correcting itself after the fact. */
  canShareScreen: boolean;
}

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly liveKit: LiveKitService,
    private readonly permissions: PermissionService,
    private readonly broadcast: RealtimeBroadcastService,
    private readonly organizations: OrganizationsService,
    private readonly contacts: ContactsService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    @Inject("ENV") private readonly env: Env,
  ) {}

  /** Never send the password hash itself to a client — every meeting object
   * returned from an authenticated endpoint (as opposed to used internally,
   * e.g. to verify a join attempt) must go through this first. Mirrors the
   * shape the public join-preview endpoint (findByCode) already exposes:
   * `requiresPassword`, not the hash. */
  private sanitizeMeeting<T extends { passwordHash: string | null }>(
    meeting: T,
  ): Omit<T, "passwordHash"> & { requiresPassword: boolean } {
    const { passwordHash, ...rest } = meeting;
    return { ...rest, requiresPassword: Boolean(passwordHash) };
  }

  async create(userId: string, dto: CreateMeetingDto) {
    if (dto.orgId) {
      const membership = await this.prisma.client.membership.findUnique({
        where: { orgId_userId: { orgId: dto.orgId, userId } },
      });
      if (!membership) {
        throw new ForbiddenException("You are not a member of that organization");
      }
      // Per-org concurrency limit, actually enforced (not just stored on
      // the Organization row) — see OrganizationsService.assertMeetingConcurrencyOk.
      await this.organizations.assertMeetingConcurrencyOk(dto.orgId);
    }

    const code = generateMeetingCode();
    const passwordHash = dto.password ? await argon2.hash(dto.password) : null;

    const meeting = await this.prisma.client.meeting.create({
      data: {
        code,
        title: dto.title,
        type: dto.type,
        ownerId: userId,
        orgId: dto.orgId,
        passwordHash,
        scheduledStart: dto.scheduledStart ? new Date(dto.scheduledStart) : null,
        scheduledEnd: dto.scheduledEnd ? new Date(dto.scheduledEnd) : null,
        timezone: dto.timezone,
        recurrenceFrequency: dto.recurrenceFrequency,
        recurrenceUntil: dto.recurrenceUntil ? new Date(dto.recurrenceUntil) : null,
        livekitRoomName: generateLiveKitRoomName(code),
        status: dto.type === "SCHEDULED" || dto.type === "RECURRING" ? "SCHEDULED" : "WAITING",
        settings: {
          create: {
            waitingRoomEnabled: dto.settings?.waitingRoomEnabled ?? true,
            allowJoinBeforeHost: dto.settings?.allowJoinBeforeHost ?? false,
            muteOnEntry: dto.settings?.muteOnEntry ?? true,
            screenShareScope: dto.settings?.screenShareScope ?? "HOST_ONLY",
            allowChat: dto.settings?.allowChat ?? true,
            allowRecording: dto.settings?.allowRecording ?? true,
            allowParticipantsUnmuteSelf: dto.settings?.allowParticipantsUnmuteSelf ?? true,
            lockAfterStart: dto.settings?.lockAfterStart ?? false,
            maxParticipants: dto.settings?.maxParticipants ?? 100,
          },
        },
        chatRoom: { create: { type: "MEETING" } },
      },
      include: { settings: true },
    });

    return this.sanitizeMeeting(meeting);
  }

  /** "My personal meeting room" — a Meeting that's created once per user and
   * reused forever (same code, same link) rather than a fresh one per call.
   * Uniqueness per owner is enforced here (findFirst-before-create) rather than
   * a DB constraint — see the isPersonalRoom comment on the Meeting model. */
  async getOrCreatePersonalRoom(userId: string) {
    const existing = await this.prisma.client.meeting.findFirst({
      where: { ownerId: userId, isPersonalRoom: true, deletedAt: null },
      include: { settings: true },
    });
    if (existing) return this.sanitizeMeeting(existing);

    const code = generateMeetingCode();
    const created = await this.prisma.client.meeting.create({
      data: {
        code,
        title: "Personal meeting room",
        type: "INSTANT",
        ownerId: userId,
        isPersonalRoom: true,
        livekitRoomName: generateLiveKitRoomName(code),
        status: "WAITING",
        settings: {
          create: {
            waitingRoomEnabled: false,
            allowJoinBeforeHost: true,
            muteOnEntry: true,
            screenShareScope: "ALL_PARTICIPANTS",
            allowChat: true,
            allowRecording: true,
            allowParticipantsUnmuteSelf: true,
            lockAfterStart: false,
            maxParticipants: 100,
          },
        },
        chatRoom: { create: { type: "MEETING" } },
      },
      include: { settings: true },
    });
    return this.sanitizeMeeting(created);
  }

  async findByCode(code: string) {
    const meeting = await this.prisma.client.meeting.findUnique({
      where: { code },
      include: {
        settings: true,
        organization: { select: { name: true, logoUrl: true, brandColor: true, joinPageMessage: true } },
      },
    });
    if (!meeting || meeting.deletedAt) throw new NotFoundException("Meeting not found");
    return meeting;
  }

  async findById(id: string) {
    const meeting = await this.prisma.client.meeting.findUnique({
      where: { id },
      include: { settings: true },
    });
    if (!meeting || meeting.deletedAt) throw new NotFoundException("Meeting not found");
    return meeting;
  }

  async listMine(userId: string) {
    const meetings = await this.prisma.client.meeting.findMany({
      where: {
        deletedAt: null,
        OR: [{ ownerId: userId }, { participants: { some: { userId } } }],
      },
      include: { settings: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return meetings.map((m) => this.sanitizeMeeting(m));
  }

  async updateSettings(meetingId: string, userId: string, dto: UpdateMeetingDto) {
    await this.permissions.requireOwnerOrCapability(meetingId, userId, "meeting.settings.update");
    const meeting = await this.findById(meetingId);

    // dto is `createMeetingSchema.partial()`, so it validates (and this
    // endpoint used to silently accept, then discard) every field `create()`
    // takes — including `password`, `timezone`, `recurrenceFrequency`, and
    // `recurrenceUntil`, none of which were ever written here. Worst case
    // was `password`: rotating a leaked meeting password returned 200 with
    // the "updated" meeting, but the old passwordHash — and old password —
    // silently kept working forever. Re-hash only when a new password was
    // actually sent; omitted means "leave the current password as-is", same
    // as every other field below (Prisma treats `undefined` as "don't touch
    // this column", not "clear it"). `updateMeetingSchema` widens `password`
    // to `string | null | undefined` specifically so a client CAN say "clear
    // it" (explicit `null`, written straight through to a null passwordHash)
    // distinctly from "leave it" (omitted) — the UI had no way to remove a
    // password at all before this, only ever replace one.
    const passwordHash =
      dto.password === undefined ? undefined : dto.password === null ? null : await argon2.hash(dto.password);

    // `type` and `orgId` are deliberately still excluded here, not another
    // oversight: `create()` performs org-membership and per-org concurrency
    // checks before either is written, and changing `type` post-creation
    // would need `status` (computed from `type` at creation) reconciled
    // too. Neither of those belongs silently bolted onto a "settings" update
    // — they'd need their own explicit endpoint if ever needed.
    const updated = await this.prisma.client.meeting.update({
      where: { id: meeting.id },
      data: {
        title: dto.title,
        passwordHash,
        timezone: dto.timezone,
        recurrenceFrequency: dto.recurrenceFrequency,
        recurrenceUntil: dto.recurrenceUntil ? new Date(dto.recurrenceUntil) : undefined,
        scheduledStart: dto.scheduledStart ? new Date(dto.scheduledStart) : undefined,
        scheduledEnd: dto.scheduledEnd ? new Date(dto.scheduledEnd) : undefined,
        settings: dto.settings
          ? {
              update: dto.settings,
            }
          : undefined,
      },
      include: { settings: true },
    });
    return this.sanitizeMeeting(updated);
  }

  // --- Invite by email ---------------------------------------------------
  // `MeetingInvite` (and the MEETING_INVITE notification type) existed in
  // the schema from the start but nothing ever created, read, or exposed a
  // single row through it — real scaffolding waiting to be wired up, the
  // same pattern this codebase already had for `FileAsset`, `MeetingInvite`
  // (itself, ironically, called out by name in that very comment — see
  // MailService's own class doc), and `ChatRoom.photoUrl` before each was
  // fixed. There was genuinely no way to invite a specific person to a
  // meeting at all, only a copyable link/code.
  //
  // Deliberately simpler than OrganizationInvite's flow: accepting an org
  // invite actually grants membership, so it needs its own token-gated
  // accept step. Joining a meeting is already a complete, well-tested flow
  // on its own (waiting room, password, domain restriction — see `join()`
  // below) that works the moment someone has the meeting's code, so the
  // invite here is just a real notification (email + in-app) carrying a
  // direct link to that existing join page — not a parallel access-control
  // mechanism. `token` is still generated and stored for the same
  // audit-trail reasons OrganizationInvite has one, and to keep the two
  // models structurally consistent, even though nothing currently redeems
  // it. A deliberate v1 scope line, not an oversight: this does NOT let an
  // invited email skip the waiting room or an email-domain restriction —
  // those stay exactly as strict as they are for anyone else.
  private static readonly INVITE_TTL_DAYS = 7;

  async listInvites(meetingId: string, actingUserId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, actingUserId, "meeting.settings.update");
    return this.prisma.client.meetingInvite.findMany({
      where: { meetingId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
  }

  async inviteByEmail(
    meetingId: string,
    actingUserId: string,
    email: string,
    role: "CO_HOST" | "PARTICIPANT",
  ) {
    await this.permissions.requireOwnerOrCapability(meetingId, actingUserId, "meeting.settings.update");
    const meeting = await this.findById(meetingId);
    const inviter = await this.prisma.client.user.findUniqueOrThrow({ where: { id: actingUserId } });

    const existingUser = await this.prisma.client.user.findUnique({ where: { email } });
    const alreadyParticipant = existingUser
      ? await this.prisma.client.meetingParticipant.findFirst({
          where: { meetingId, userId: existingUser.id },
        })
      : null;
    if (alreadyParticipant) throw new ConflictException("This person is already part of this meeting");

    const token = nanoid(32);
    // A meeting invite naturally stops mattering once the meeting it's for
    // is over — expire it then rather than on a flat calendar TTL, when a
    // scheduled end time actually exists. Instant/recurring-with-no-end
    // meetings fall back to the same flat window OrganizationInvite uses.
    const flatExpiry = new Date(Date.now() + MeetingsService.INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const expiresAt = meeting.scheduledEnd && meeting.scheduledEnd > new Date() ? meeting.scheduledEnd : flatExpiry;

    // A still-PENDING invite for the same email gets refreshed in place
    // (new token, new expiry, resent) rather than erroring — same call
    // OrganizationInvite.inviteByEmail makes, for the same reason: inviting
    // someone twice before they've responded isn't a conflict worth
    // blocking on.
    const existingInvite = await this.prisma.client.meetingInvite.findFirst({
      where: { meetingId, email, status: "PENDING" },
    });
    const invite = existingInvite
      ? await this.prisma.client.meetingInvite.update({
          where: { id: existingInvite.id },
          data: { role, token, expiresAt, invitedByUserId: actingUserId },
        })
      : await this.prisma.client.meetingInvite.create({
          data: { meetingId, email, role, token, expiresAt, invitedByUserId: actingUserId },
        });

    const joinUrl = `${this.env.WEB_URL}/meeting/${meeting.code}`;
    // Email delivery failing shouldn't undo a real invite row that was
    // already created — same reasoning as OrganizationInvite.inviteByEmail:
    // log and continue rather than throwing through to the controller as a
    // 500 for what's fundamentally a best-effort notification channel.
    await this.mail
      .sendMeetingInvite({
        to: email,
        meetingTitle: meeting.title,
        inviterName: inviter.displayName,
        joinUrl,
        scheduledStart: meeting.scheduledStart,
      })
      .catch(() => {});

    if (existingUser) {
      await this.notifications.create({
        userId: existingUser.id,
        type: "MEETING_INVITE",
        title: `Invited to "${meeting.title}"`,
        body: `${inviter.displayName} invited you to a meeting${meeting.scheduledStart ? ` on ${meeting.scheduledStart.toLocaleDateString()}` : ""}.`,
        data: { meetingCode: meeting.code, meetingId: meeting.id, meetingTitle: meeting.title },
      });
    }

    return invite;
  }

  async revokeInvite(meetingId: string, actingUserId: string, inviteId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, actingUserId, "meeting.settings.update");
    const invite = await this.prisma.client.meetingInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.meetingId !== meetingId) throw new NotFoundException("Invite not found");
    await this.prisma.client.meetingInvite.update({
      where: { id: inviteId },
      data: { status: "REVOKED" },
    });
  }

  async end(meetingId: string, userId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, userId, "meeting.end");
    const meeting = await this.findById(meetingId);

    const updated = await this.prisma.client.meeting.update({
      where: { id: meeting.id },
      data: { status: "ENDED", actualEnd: new Date() },
    });
    // Broadcast before forcibly closing the LiveKit room, not after: everyone
    // still connected gets the friendly "this meeting has ended" screen
    // (already fully wired client-side — see use-meeting-socket.ts's
    // `meetingEnded` state — this was the one missing piece) an instant
    // before LiveKit's own disconnect lands, instead of just going dark.
    await this.broadcast.publish(meeting.id, WS_EVENTS.MEETING_ENDED, {});
    await this.liveKit.endRoom(meeting.livekitRoomName);
    return updated;
  }

  /**
   * Resolves (or creates) this caller's MeetingParticipant row, decides whether they
   * land in the waiting room or are admitted immediately, and — only if admitted —
   * mints a LiveKit token. Password, domain-restriction, block, and lock checks all
   * happen here, server-side, before any token is ever issued.
   */
  async join(
    code: string,
    caller: { userId?: string; email?: string; guestName?: string; guestParticipantId?: string },
    dto: JoinMeetingDto,
  ): Promise<JoinResult> {
    const meeting = await this.findByCode(code);
    if (meeting.status === "ENDED" || meeting.status === "CANCELED") {
      throw new BadRequestException("This meeting has ended");
    }
    if (!meeting.settings) throw new NotFoundException("Meeting settings missing");

    if (meeting.passwordHash) {
      if (!dto.password || !(await argon2.verify(meeting.passwordHash, dto.password))) {
        throw new ForbiddenException("Incorrect meeting password");
      }
    }

    const isOwner = caller.userId === meeting.ownerId;

    // Domain restriction — the owner is always exempt (it's their own
    // meeting). A guest has no account email to check at all, so once this
    // is non-empty a guest is always refused rather than silently admitted.
    if (!isOwner && meeting.settings.allowedEmailDomains.length > 0) {
      const domain = caller.email?.split("@")[1]?.toLowerCase();
      if (!domain || !meeting.settings.allowedEmailDomains.includes(domain)) {
        throw new ForbiddenException("This meeting is restricted to specific email domains");
      }
    }

    // Block — directional (see ContactsService.hasBlocked's own doc comment):
    // only the meeting owner's own block gates their own meeting.
    if (!isOwner && caller.userId && (await this.contacts.hasBlocked(meeting.ownerId, caller.userId))) {
      throw new ForbiddenException("You are not able to join this meeting");
    }

    if (!caller.userId && !dto.guestName && !caller.guestName) {
      throw new BadRequestException("Guests must provide a display name");
    }

    let role: ParticipantRole = isOwner ? "HOST" : caller.userId ? "PARTICIPANT" : "GUEST";

    // Class sessions assign TEACHER/STUDENT from the class roster instead of the
    // generic HOST/PARTICIPANT default, so classroom capabilities (whiteboard,
    // polls, quizzes, attendance) resolve correctly via the same capability
    // matrix meetings already use — see packages/types/src/permissions.ts.
    //
    // CS-2: this used to be gated on `!isOwner`, so the teacher who actually
    // started their own class session — the single most common case — never
    // reached it at all and stayed the generic "HOST" default from above,
    // while any OTHER teacher joining the same session correctly got
    // "TEACHER". Capabilities were identical either way (HOST and TEACHER
    // are both full moderators — see MODERATOR_ROLES/the permissions
    // matrix), so this was purely a label mismatch, not a permissions bug —
    // but it's still confusing to a teacher to see themselves called
    // something else in their own classroom.
    if (caller.userId) {
      const classSession = await this.prisma.client.classSession.findUnique({
        where: { meetingId: meeting.id },
      });
      if (classSession) {
        const [isTeacher, isStudent] = await Promise.all([
          this.prisma.client.classTeacher.findUnique({
            where: { classId_userId: { classId: classSession.classId, userId: caller.userId } },
          }),
          this.prisma.client.classStudent.findUnique({
            where: { classId_userId: { classId: classSession.classId, userId: caller.userId } },
          }),
        ]);
        if (isTeacher) role = "TEACHER";
        else if (isStudent) role = "STUDENT";
      }
    }

    // Existing participant reconnecting keeps their previously assigned role
    // (e.g. a promoted co-host doesn't get demoted just by refreshing the page).
    // A guest has no account identity to look this up by — `guestParticipantId`
    // (their own prior row's id, remembered client-side across a reload) is
    // the only way a returning guest can ever be recognized as the SAME guest
    // rather than a brand-new one. Without this, the DENIED/REMOVED check
    // just below could never apply to a guest at all: every "rejoin" would
    // silently create a fresh WAITING row no matter what happened to the
    // last one.
    const existing = caller.userId
      ? await this.prisma.client.meetingParticipant.findFirst({
          where: { meetingId: meeting.id, userId: caller.userId },
        })
      : caller.guestParticipantId
        ? await this.prisma.client.meetingParticipant.findFirst({
            where: { id: caller.guestParticipantId, meetingId: meeting.id, userId: null },
          })
        : null;
    if (existing) role = existing.role as ParticipantRole;

    // Without this, a denied or removed participant could undo either just
    // by reloading the page: the write below unconditionally resets an
    // existing row's status to WAITING/ADMITTED with no regard for what it
    // already was, so a reconnect silently re-admitted someone a host had
    // explicitly refused or kicked moments earlier — deny (and remove) was
    // reversible by pressing F5. Owner is exempt in principle (own meeting),
    // though DENIED/REMOVED would never actually apply to their own row.
    if (existing && !isOwner) {
      if (existing.status === "DENIED") {
        throw new ForbiddenException("You have been denied entry to this meeting");
      }
      if (existing.status === "REMOVED") {
        throw new ForbiddenException("You have been removed from this meeting");
      }
    }

    if (meeting.settings.lockAfterStart && meeting.status === "LIVE" && !existing && !isOwner) {
      throw new ForbiddenException("This meeting is locked");
    }

    const requiresWaiting =
      meeting.settings.waitingRoomEnabled &&
      role !== "HOST" &&
      role !== "CO_HOST" &&
      role !== "TEACHER" &&
      !isOwner;
    const status: "WAITING" | "ADMITTED" = requiresWaiting ? "WAITING" : "ADMITTED";

    const livekitIdentity = existing?.livekitIdentity ?? `${caller.userId ?? "guest"}-${nanoid(8)}`;

    // `existing` above is still just a read used to decide `role`/`status`
    // (an existing co-host reconnecting shouldn't be demoted or sent back to
    // the waiting room) — it does NOT make the write below race-free on its
    // own. Two overlapping joins from the same user (two tabs, a double
    // click) can both read no existing row and both reach this point still
    // believing they should create. For a real (non-guest) user this is now
    // a single atomic upsert keyed on the meetingId_userId unique
    // constraint, so the loser of that race updates the winner's row
    // instead of creating a duplicate one — Postgres, not a check-then-act
    // race, decides who "wins".
    //
    // A returning guest (found above via guestParticipantId) instead UPDATEs
    // their own known row directly by id — there's no unique-constraint race
    // to resolve here since a brand-new guest with no guestParticipantId
    // always creates, and a guest that already has one is updating a row
    // only their own browser knows the id of. Keeping the SAME participant
    // id across a guest's reload is the entire point: it's what lets their
    // next guest token (signed with this id as `sub`) still resolve to the
    // same row PermissionService already checked for DENIED/REMOVED above.
    const participant = caller.userId
      ? await this.prisma.client.meetingParticipant.upsert({
          where: { meetingId_userId: { meetingId: meeting.id, userId: caller.userId } },
          update: { status, guestName: caller.guestName ?? dto.guestName },
          create: {
            meetingId: meeting.id,
            userId: caller.userId,
            guestName: caller.guestName ?? dto.guestName,
            role,
            status,
            livekitIdentity,
          },
        })
      : existing
        ? await this.prisma.client.meetingParticipant.update({
            where: { id: existing.id },
            data: { status, guestName: caller.guestName ?? dto.guestName },
          })
        : await this.prisma.client.meetingParticipant.create({
            data: {
              meetingId: meeting.id,
              userId: caller.userId,
              guestName: caller.guestName ?? dto.guestName,
              role,
              status,
              livekitIdentity,
            },
          });

    await this.prisma.client.meetingEvent.create({
      data: {
        meetingId: meeting.id,
        participantId: participant.id,
        userId: caller.userId,
        type: status === "WAITING" ? "WAITING_ROOM_JOIN" : "JOIN",
      },
    });

    let livekitToken: string | null = null;
    let livekitUrl: string | null = null;
    // No real answer for a WAITING participant — no token's been issued yet
    // to have granted (or not) the publish source. Recomputed for real once
    // actually ADMITTED, below.
    let canShareScreen = false;

    if (status === "ADMITTED") {
      const result = await this.admitAndIssueToken(meeting.id, participant.id);
      livekitToken = result.token;
      livekitUrl = result.url;
      canShareScreen = result.canShareScreen;
    } else {
      await this.broadcast.publish(meeting.id, WS_EVENTS.WAITING_ROOM_JOINED, {
        participantId: participant.id,
        displayName: participant.guestName ?? "Participant",
      });
    }

    // Minted unconditionally for a guest, regardless of WAITING vs ADMITTED —
    // a waiting guest still needs a working authenticated socket connection
    // to ever receive the admit/deny decision in the first place (see
    // RealtimeGateway.handleConnection and ParticipantsService.admit/deny).
    // `sub` is this row's own id, kept stable across reloads by the
    // create/update branch above.
    const guestToken = !caller.userId
      ? this.tokens.signGuestToken({ sub: participant.id, meetingId: meeting.id, kind: "guest" })
      : null;

    return {
      participantId: participant.id,
      role: participant.role as ParticipantRole,
      status,
      meeting: {
        id: meeting.id,
        code: meeting.code,
        title: meeting.title,
        livekitRoomName: meeting.livekitRoomName,
      },
      livekitToken,
      livekitUrl,
      guestToken,
      canShareScreen,
    };
  }

  /** Authenticated-caller-facing token reissue (e.g. after a reconnect): only the
   * participant themselves, or someone with moderator authority in the meeting, may
   * request a token for a given participantId — otherwise any authenticated user
   * could mint themselves a token to impersonate another participant's identity. */
  async issueTokenForCaller(meetingId: string, participantId: string, callerUserId: string) {
    const participant = await this.prisma.client.meetingParticipant.findUnique({
      where: { id: participantId },
    });
    if (!participant || participant.meetingId !== meetingId) {
      throw new NotFoundException("Participant not found");
    }
    // "Is the caller reissuing their OWN token" — for a guest, `callerUserId`
    // here is their own MeetingParticipant.id (there's no User.id to compare
    // against; see JwtAuthGuard/TokenService.GuestTokenPayload), the same
    // identity substitution PermissionService.getParticipant already makes.
    // Comparing only against `participant.userId` would always read as
    // false for a guest reissuing their own token (null !== their id),
    // wrongly routing every guest through the moderator-only capability
    // check below and rejecting them outright.
    if ((participant.userId ?? participant.id) !== callerUserId) {
      await this.permissions.requireOwnerOrCapability(
        meetingId,
        callerUserId,
        "participant.role.promote_co_host",
      );
    }
    return this.issueToken(meetingId, participantId);
  }

  /** Issues (or re-issues, for reconnects) a LiveKit token for an already-ADMITTED participant. */
  async issueToken(meetingId: string, participantId: string) {
    const participant = await this.prisma.client.meetingParticipant.findUnique({
      where: { id: participantId },
      // Only need `displayName`, but the previous code fell back to the raw
      // `userId` UUID for every real account's video-tile label — LiveKit's
      // `name` is exactly what the client renders under each tile (see
      // VideoGrid), so a missing join here meant every authenticated
      // participant's own name was never actually used for it.
      include: { user: { select: { displayName: true } } },
    });
    if (!participant || participant.meetingId !== meetingId) {
      throw new NotFoundException("Participant not found");
    }
    if (participant.status !== "ADMITTED" && participant.status !== "JOINED") {
      throw new ForbiddenException("Not yet admitted to this meeting");
    }
    const meeting = await this.findById(meetingId);
    const role = participant.role as ParticipantRole;
    const canScreenShare = this.computeCanShareScreen(role, meeting.settings?.screenShareScope);

    await this.liveKit.ensureRoom(meeting.livekitRoomName, meeting.settings?.maxParticipants ?? 100);
    const token = await this.liveKit.createRoomToken({
      roomName: meeting.livekitRoomName,
      identity: participant.livekitIdentity,
      name: participant.guestName ?? participant.user?.displayName ?? "Guest",
      canPublishScreenShare: canScreenShare,
    });
    return { token, url: this.liveKit.getClientUrl(), canShareScreen: canScreenShare };
  }

  /** Shared by issueToken (the token's actual publish grant) and join (what
   * the client's initial toolbar state should show) — kept as one place so
   * the two can never quietly disagree with each other. Not just `role`:
   * a PARTICIPANT/STUDENT additionally gets it when the meeting's own
   * `screenShareScope` setting is ALL_PARTICIPANTS, a real, working setting
   * (MeetingsService.updateSettings) with no toolbar of its own to flip it
   * — see docs/roadmap.md or this stage's own PR for the reasoning; per-
   * request approval (ParticipantsService.approveScreenShare) exists
   * alongside it for a moderator who'd rather grant it person-by-person
   * than open it to everyone at once. */
  private computeCanShareScreen(role: ParticipantRole, screenShareScope: string | undefined): boolean {
    const isModerator = ["OWNER", "HOST", "CO_HOST", "TEACHER"].includes(role);
    return isModerator || screenShareScope === "ALL_PARTICIPANTS";
  }

  private async admitAndIssueToken(meetingId: string, participantId: string) {
    const meeting = await this.findById(meetingId);
    if (meeting.status === "SCHEDULED" || meeting.status === "WAITING") {
      await this.prisma.client.meeting.update({
        where: { id: meetingId },
        data: { status: "LIVE", actualStart: meeting.actualStart ?? new Date() },
      });
    }
    return this.issueToken(meetingId, participantId);
  }
}
