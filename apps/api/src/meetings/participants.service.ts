import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { WS_EVENTS } from "@arutech/types";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitService } from "../livekit/livekit.service";
import { PermissionService } from "./permission.service";
import { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import { AuditLogService } from "../audit/audit-log.service";

@Injectable()
export class ParticipantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly liveKit: LiveKitService,
    private readonly permissions: PermissionService,
    private readonly broadcast: RealtimeBroadcastService,
    private readonly auditLog: AuditLogService,
  ) {}

  async listWaitingRoom(meetingId: string, callerUserId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "waiting_room.admit");
    return this.prisma.client.meetingParticipant.findMany({
      where: { meetingId, status: "WAITING" },
      include: { user: { select: { displayName: true, avatarUrl: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async list(meetingId: string, callerUserId: string) {
    // Any current participant may view the roster; enforced by requiring the caller
    // to already have a participant row (getParticipant throws NotFoundException otherwise).
    await this.permissions.getParticipant(meetingId, callerUserId).catch(async () => {
      const meeting = await this.prisma.client.meeting.findUnique({ where: { id: meetingId } });
      if (meeting?.ownerId !== callerUserId) throw new NotFoundException("Not a participant");
    });
    return this.prisma.client.meetingParticipant.findMany({
      where: { meetingId, status: { in: ["ADMITTED", "JOINED"] } },
      include: { user: { select: { displayName: true, avatarUrl: true } } },
      orderBy: { joinedAt: "asc" },
    });
  }

  async admit(meetingId: string, callerUserId: string, participantId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "waiting_room.admit");
    const participant = await this.getOrThrow(meetingId, participantId);
    if (participant.status !== "WAITING") {
      throw new BadRequestException("Participant is not waiting");
    }
    await this.prisma.client.meetingParticipant.update({
      where: { id: participantId },
      data: { status: "ADMITTED" },
    });
    // Broadcasting only to the meeting room (below) doesn't reach the admitted
    // participant themselves: RealtimeGateway.onJoinMeeting deliberately
    // refuses to let a WAITING participant's socket join that room at all
    // (they're not admitted yet — that's the whole point of a waiting room),
    // so they were never in it to receive this event. Their personal
    // `user:{id}` room (joined on every socket connect, auth-gated so guests
    // don't have one — same limitation guests already have elsewhere) is what
    // actually delivers it to them; the meeting-room publish below is kept for
    // any other listener (e.g. a host's own UI reacting to the admit).
    if (participant.userId) {
      await this.broadcast.publishToRoom(`user:${participant.userId}`, WS_EVENTS.WAITING_ROOM_ADMIT, {
        participantId,
      });
    }
    await this.broadcast.publish(meetingId, WS_EVENTS.WAITING_ROOM_ADMIT, { participantId });
  }

  async deny(meetingId: string, callerUserId: string, participantId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "waiting_room.deny");
    await this.getOrThrow(meetingId, participantId);
    await this.prisma.client.meetingParticipant.update({
      where: { id: participantId },
      data: { status: "DENIED" },
    });
    await this.broadcast.publish(meetingId, WS_EVENTS.WAITING_ROOM_DENY, { participantId });
  }

  async mute(meetingId: string, callerUserId: string, participantId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "participant.mute");
    const { meeting, participant } = await this.getWithMeeting(meetingId, participantId);
    await this.liveKit.muteParticipantTrack(meeting.livekitRoomName, participant.livekitIdentity, "microphone");
    await this.logEvent(meetingId, participantId, "MODERATION_MUTE");
    await this.broadcast.publish(meetingId, WS_EVENTS.MODERATION_MUTE, { participantId });
  }

  async disableCamera(meetingId: string, callerUserId: string, participantId: string) {
    await this.permissions.requireOwnerOrCapability(
      meetingId,
      callerUserId,
      "participant.camera.disable",
    );
    const { meeting, participant } = await this.getWithMeeting(meetingId, participantId);
    await this.liveKit.muteParticipantTrack(meeting.livekitRoomName, participant.livekitIdentity, "camera");
    await this.logEvent(meetingId, participantId, "MODERATION_CAMERA_DISABLE");
    await this.broadcast.publish(meetingId, WS_EVENTS.MODERATION_CAMERA_DISABLE, { participantId });
  }

  async remove(meetingId: string, callerUserId: string, participantId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "participant.remove");
    const { meeting, participant } = await this.getWithMeeting(meetingId, participantId);
    await this.liveKit.removeParticipant(meeting.livekitRoomName, participant.livekitIdentity);
    await this.prisma.client.meetingParticipant.update({
      where: { id: participantId },
      data: { status: "REMOVED", leftAt: new Date() },
    });
    await this.logEvent(meetingId, participantId, "MODERATION_REMOVE");
    await this.auditLog.record({
      actorUserId: callerUserId,
      action: "participant.remove",
      targetType: "meeting_participant",
      targetId: participantId,
      metadata: { meetingId, removedUserId: participant.userId },
    });
    await this.broadcast.publish(meetingId, WS_EVENTS.MODERATION_REMOVE, { participantId });
  }

  async promoteCoHost(meetingId: string, callerUserId: string, participantId: string) {
    await this.permissions.requireOwnerOrCapability(
      meetingId,
      callerUserId,
      "participant.role.promote_co_host",
    );
    const { meeting, participant } = await this.getWithMeeting(meetingId, participantId);
    await this.prisma.client.meetingParticipant.update({
      where: { id: participantId },
      data: { role: "CO_HOST" },
    });
    await this.liveKit.updateParticipantPermissions(meeting.livekitRoomName, participant.livekitIdentity, {
      canPublishScreenShare: true,
    });
    await this.logEvent(meetingId, participantId, "MODERATION_PROMOTE_CO_HOST");
    await this.auditLog.record({
      actorUserId: callerUserId,
      action: "participant.promote_co_host",
      targetType: "meeting_participant",
      targetId: participantId,
      metadata: { meetingId, promotedUserId: participant.userId },
    });
    await this.broadcast.publish(meetingId, WS_EVENTS.MODERATION_ROLE_CHANGE, {
      participantId,
      role: "CO_HOST",
    });
  }

  private async getOrThrow(meetingId: string, participantId: string) {
    const participant = await this.prisma.client.meetingParticipant.findUnique({
      where: { id: participantId },
    });
    if (!participant || participant.meetingId !== meetingId) {
      throw new NotFoundException("Participant not found");
    }
    return participant;
  }

  private async getWithMeeting(meetingId: string, participantId: string) {
    const participant = await this.getOrThrow(meetingId, participantId);
    const meeting = await this.prisma.client.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    return { meeting, participant };
  }

  private async logEvent(meetingId: string, participantId: string, type: string) {
    await this.prisma.client.meetingEvent.create({
      data: { meetingId, participantId, type },
    });
  }
}
