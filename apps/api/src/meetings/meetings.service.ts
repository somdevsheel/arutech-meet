import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { nanoid } from "nanoid";
import { WS_EVENTS, type ParticipantRole } from "@arutech/types";
import type { CreateMeetingDto, JoinMeetingDto, UpdateMeetingDto } from "@arutech/validation";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitService } from "../livekit/livekit.service";
import { PermissionService } from "./permission.service";
import { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import { generateLiveKitRoomName, generateMeetingCode } from "../common/lib/meeting-code";

export interface JoinResult {
  participantId: string;
  role: ParticipantRole;
  status: "WAITING" | "ADMITTED";
  meeting: { id: string; code: string; title: string; livekitRoomName: string };
  livekitUrl: string | null;
  livekitToken: string | null;
}

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly liveKit: LiveKitService,
    private readonly permissions: PermissionService,
    private readonly broadcast: RealtimeBroadcastService,
  ) {}

  async create(userId: string, dto: CreateMeetingDto) {
    if (dto.orgId) {
      const membership = await this.prisma.client.membership.findUnique({
        where: { orgId_userId: { orgId: dto.orgId, userId } },
      });
      if (!membership) {
        throw new ForbiddenException("You are not a member of that organization");
      }
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

    return meeting;
  }

  async findByCode(code: string) {
    const meeting = await this.prisma.client.meeting.findUnique({
      where: { code },
      include: { settings: true },
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
    return this.prisma.client.meeting.findMany({
      where: {
        deletedAt: null,
        OR: [{ ownerId: userId }, { participants: { some: { userId } } }],
      },
      include: { settings: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async updateSettings(meetingId: string, userId: string, dto: UpdateMeetingDto) {
    await this.permissions.requireOwnerOrCapability(meetingId, userId, "meeting.settings.update");
    const meeting = await this.findById(meetingId);

    return this.prisma.client.meeting.update({
      where: { id: meeting.id },
      data: {
        title: dto.title,
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
  }

  async end(meetingId: string, userId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, userId, "meeting.end");
    const meeting = await this.findById(meetingId);

    await this.liveKit.endRoom(meeting.livekitRoomName);
    return this.prisma.client.meeting.update({
      where: { id: meeting.id },
      data: { status: "ENDED", actualEnd: new Date() },
    });
  }

  /**
   * Resolves (or creates) this caller's MeetingParticipant row, decides whether they
   * land in the waiting room or are admitted immediately, and — only if admitted —
   * mints a LiveKit token. Password and lock checks happen here, server-side, before
   * any token is ever issued.
   */
  async join(
    code: string,
    caller: { userId?: string; guestName?: string },
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

    if (!caller.userId && !dto.guestName && !caller.guestName) {
      throw new BadRequestException("Guests must provide a display name");
    }

    const isOwner = caller.userId === meeting.ownerId;
    let role: ParticipantRole = isOwner ? "HOST" : caller.userId ? "PARTICIPANT" : "GUEST";

    // Class sessions assign TEACHER/STUDENT from the class roster instead of the
    // generic HOST/PARTICIPANT default, so classroom capabilities (whiteboard,
    // polls, quizzes, attendance) resolve correctly via the same capability
    // matrix meetings already use — see packages/types/src/permissions.ts.
    if (!isOwner && caller.userId) {
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
    const existing = caller.userId
      ? await this.prisma.client.meetingParticipant.findFirst({
          where: { meetingId: meeting.id, userId: caller.userId },
        })
      : null;
    if (existing) role = existing.role as ParticipantRole;

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

    const participant = existing
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

    if (status === "ADMITTED") {
      const result = await this.admitAndIssueToken(meeting.id, participant.id);
      livekitToken = result.token;
      livekitUrl = result.url;
    } else {
      await this.broadcast.publish(meeting.id, WS_EVENTS.WAITING_ROOM_JOINED, {
        participantId: participant.id,
        displayName: participant.guestName ?? "Participant",
      });
    }

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
    if (participant.userId !== callerUserId) {
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
    });
    if (!participant || participant.meetingId !== meetingId) {
      throw new NotFoundException("Participant not found");
    }
    if (participant.status !== "ADMITTED" && participant.status !== "JOINED") {
      throw new ForbiddenException("Not yet admitted to this meeting");
    }
    const meeting = await this.findById(meetingId);
    const role = participant.role as ParticipantRole;
    const isModerator = ["OWNER", "HOST", "CO_HOST", "TEACHER"].includes(role);
    const canScreenShare =
      isModerator || meeting.settings?.screenShareScope === "ALL_PARTICIPANTS";

    await this.liveKit.ensureRoom(meeting.livekitRoomName, meeting.settings?.maxParticipants ?? 100);
    const token = await this.liveKit.createRoomToken({
      roomName: meeting.livekitRoomName,
      identity: participant.livekitIdentity,
      name: participant.guestName ?? participant.userId ?? "Guest",
      canPublishScreenShare: canScreenShare,
    });
    return { token, url: this.liveKit.getClientUrl() };
  }

  private async admitAndIssueToken(meetingId: string, participantId: string) {
    const meeting = await this.findById(meetingId);
    if (meeting.status === "SCHEDULED" || meeting.status === "WAITING") {
      await this.prisma.client.meeting.update({
        where: { id: meetingId },
        data: { status: "LIVE", actualStart: meeting.actualStart ?? new Date() },
      });
    }
    const { token, url } = await this.issueToken(meetingId, participantId);
    return { token, url };
  }
}
