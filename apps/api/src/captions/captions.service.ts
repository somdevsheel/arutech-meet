import { Injectable, NotFoundException } from "@nestjs/common";
import { WS_EVENTS } from "@arutech/types";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitService } from "../livekit/livekit.service";
import { PermissionService } from "../meetings/permission.service";
import { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";

/**
 * Live captions — host-triggered start/stop of the captions agent worker
 * (services/transcription), explicitly LiveKit-Agent-dispatched into the
 * meeting's room, not automatic for every meeting (real infra cost: a worker
 * process plus a per-utterance OpenAI Realtime STT connection — same
 * opt-in reasoning recording already has). This service only manages the
 * dispatch lifecycle; the caption *text* never passes through here or
 * through our own realtime gateway at all — the agent publishes it directly
 * as LiveKit's native room transcription, read client-side via
 * @livekit/components-react's useTranscriptions(). See
 * docs/roadmap.md's Live captions stage for the full architecture.
 */
@Injectable()
export class CaptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly liveKit: LiveKitService,
    private readonly permissions: PermissionService,
    private readonly broadcast: RealtimeBroadcastService,
  ) {}

  private async findRoomName(meetingId: string): Promise<string> {
    const meeting = await this.prisma.client.meeting.findUnique({
      where: { id: meetingId },
      select: { livekitRoomName: true, deletedAt: true },
    });
    if (!meeting || meeting.deletedAt) throw new NotFoundException("Meeting not found");
    return meeting.livekitRoomName;
  }

  async start(meetingId: string, callerUserId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "captions.manage");
    const roomName = await this.findRoomName(meetingId);
    await this.liveKit.startCaptions(roomName);
    await this.broadcast.publish(meetingId, WS_EVENTS.CAPTIONS_STARTED, {});
    return { active: true };
  }

  async stop(meetingId: string, callerUserId: string) {
    await this.permissions.requireOwnerOrCapability(meetingId, callerUserId, "captions.manage");
    const roomName = await this.findRoomName(meetingId);
    await this.liveKit.stopCaptions(roomName);
    await this.broadcast.publish(meetingId, WS_EVENTS.CAPTIONS_STOPPED, {});
    return { active: false };
  }

  /** Any participant (not host-only) — lets a late joiner learn captions are
   * already on without having caught the live CAPTIONS_STARTED broadcast. */
  async status(meetingId: string, callerUserId: string) {
    await this.permissions.getParticipant(meetingId, callerUserId);
    const roomName = await this.findRoomName(meetingId);
    const active = await this.liveKit.captionsActive(roomName);
    return { active };
  }
}
