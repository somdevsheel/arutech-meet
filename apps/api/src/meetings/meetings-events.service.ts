import { Injectable, Logger } from "@nestjs/common";
import type { WebhookEvent } from "livekit-server-sdk";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Consumes verified LiveKit webhooks and reflects media-plane reality back into
 * PostgreSQL: participant join/leave timestamps (source data for attendance),
 * meeting lifecycle, and (eventually) egress/recording status. This is the
 * mechanism by which the app backend learns what happened in the SFU without
 * being on the media path itself.
 */
@Injectable()
export class MeetingsEventsService {
  private readonly logger = new Logger(MeetingsEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleLiveKitWebhook(event: WebhookEvent): Promise<void> {
    const roomName = event.room?.name;
    if (!roomName) return;

    const meeting = await this.prisma.client.meeting.findUnique({
      where: { livekitRoomName: roomName },
    });
    if (!meeting) {
      this.logger.debug(`Webhook for unknown room ${roomName}, ignoring`);
      return;
    }

    switch (event.event) {
      case "participant_joined": {
        const identity = event.participant?.identity;
        if (!identity) break;
        const participant = await this.prisma.client.meetingParticipant.findFirst({
          where: { meetingId: meeting.id, livekitIdentity: identity },
        });
        if (!participant) break;
        await this.prisma.client.meetingParticipant.update({
          where: { id: participant.id },
          data: { status: "JOINED", joinedAt: participant.joinedAt ?? new Date() },
        });
        await this.prisma.client.meetingEvent.create({
          data: {
            meetingId: meeting.id,
            participantId: participant.id,
            userId: participant.userId,
            type: "MEDIA_CONNECTED",
          },
        });
        break;
      }

      case "participant_left": {
        const identity = event.participant?.identity;
        if (!identity) break;
        const participant = await this.prisma.client.meetingParticipant.findFirst({
          where: { meetingId: meeting.id, livekitIdentity: identity },
        });
        if (!participant) break;
        await this.prisma.client.meetingParticipant.update({
          where: { id: participant.id },
          data: { status: "LEFT", leftAt: new Date() },
        });
        await this.prisma.client.meetingEvent.create({
          data: {
            meetingId: meeting.id,
            participantId: participant.id,
            userId: participant.userId,
            type: "MEDIA_DISCONNECTED",
          },
        });
        break;
      }

      case "room_finished": {
        await this.prisma.client.meeting.update({
          where: { id: meeting.id },
          data: {
            status: "ENDED",
            actualEnd: meeting.actualEnd ?? new Date(),
          },
        });
        await this.prisma.client.meetingEvent.create({
          data: { meetingId: meeting.id, type: "ROOM_FINISHED" },
        });
        break;
      }

      default:
        // egress_started / egress_ended / track_published / etc. are handled by
        // services/recording (Stage 7) and packages/database's MeetingEvent log
        // remains the generic audit trail — record unhandled-but-known events too.
        await this.prisma.client.meetingEvent.create({
          data: { meetingId: meeting.id, type: `LIVEKIT_${event.event.toUpperCase()}` },
        });
    }
  }
}
