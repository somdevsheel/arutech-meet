import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { can, type Capability, type ParticipantRole } from "@arutech/types";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The single place meeting/class authorization decisions are made. Always resolves
 * the caller's role from the database (via their userId + meetingId) — it never
 * accepts a role claimed by the client. Both REST controllers and the WebSocket
 * gateway must go through this service before performing a privileged action.
 *
 * See packages/types/src/permissions.ts for the underlying role → capability matrix.
 */
@Injectable()
export class PermissionService {
  constructor(private readonly prisma: PrismaService) {}

  async getParticipant(meetingId: string, userId: string) {
    const participant = await this.prisma.client.meetingParticipant.findFirst({
      where: { meetingId, userId },
      orderBy: { createdAt: "desc" },
    });
    if (!participant) {
      throw new NotFoundException("You are not a participant of this meeting");
    }
    // This is the one central authorization check every REST controller and
    // the WS gateway both go through — but until now it only checked that a
    // row existed, never its status. RealtimeGateway.onJoinMeeting and
    // MeetingsService.issueToken each independently added the same
    // ADMITTED/JOINED gate for their own narrower purpose; this was the
    // place that should have had it from the start. Without it, someone
    // denied at the waiting room, or removed mid-meeting, kept full REST
    // access forever afterward — chat history, recording downloads,
    // transcripts, whiteboard — since their (now-stale) row still existed.
    if (participant.status !== "ADMITTED" && participant.status !== "JOINED") {
      throw new ForbiddenException("Not currently an active participant of this meeting");
    }
    return participant;
  }

  async requireCapability(
    meetingId: string,
    userId: string,
    capability: Capability,
  ): Promise<{ role: ParticipantRole; participantId: string }> {
    const participant = await this.getParticipant(meetingId, userId);
    const role = participant.role as ParticipantRole;
    if (!can(role, capability)) {
      throw new ForbiddenException(`Role ${role} does not have permission: ${capability}`);
    }
    return { role, participantId: participant.id };
  }

  /** Meeting owner always has full authority regardless of their MeetingParticipant row
   * (e.g. managing settings before ever joining as a participant). */
  async requireOwnerOrCapability(
    meetingId: string,
    userId: string,
    capability: Capability,
  ): Promise<void> {
    const meeting = await this.prisma.client.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new NotFoundException("Meeting not found");
    if (meeting.ownerId === userId) return;
    await this.requireCapability(meetingId, userId, capability);
  }
}
