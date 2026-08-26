import { WS_EVENTS } from "@arutech/types";
import { ForbiddenException } from "@nestjs/common";
import { CaptionsService } from "./captions.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { LiveKitService } from "../livekit/livekit.service";
import type { PermissionService } from "../meetings/permission.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import type { FeatureFlagsService } from "../feature-flags/feature-flags.service";

const MEETING = { livekitRoomName: "room-1", deletedAt: null, orgId: null };

function makeService(overrides?: { liveCaptionsEnabled?: boolean }) {
  const prisma = {
    client: {
      meeting: {
        findUnique: jest.fn().mockResolvedValue(MEETING),
        findUniqueOrThrow: jest.fn().mockResolvedValue(MEETING),
      },
      meetingEvent: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    },
  } as unknown as PrismaService;
  const liveKit = {
    startCaptions: jest.fn().mockResolvedValue({ id: "dispatch-1" }),
    stopCaptions: jest.fn().mockResolvedValue(undefined),
    captionsActive: jest.fn().mockResolvedValue(true),
  } as unknown as LiveKitService;
  const permissions = {
    requireOwnerOrCapability: jest.fn().mockResolvedValue(undefined),
    getParticipant: jest.fn().mockResolvedValue({ role: "PARTICIPANT" }),
  } as unknown as PermissionService;
  const broadcast = { publish: jest.fn().mockResolvedValue(undefined) } as unknown as RealtimeBroadcastService;
  const featureFlags = {
    isEnabledForMeeting: jest.fn().mockResolvedValue(overrides?.liveCaptionsEnabled ?? true),
  } as unknown as FeatureFlagsService;

  const service = new CaptionsService(prisma, liveKit, permissions, broadcast, featureFlags);
  return { service, prisma, liveKit, permissions, broadcast, featureFlags };
}

describe("CaptionsService", () => {
  it("start() requires captions.manage and dispatches the agent by room name", async () => {
    const { service, permissions, liveKit, broadcast, featureFlags } = makeService();
    const result = await service.start("meeting-1", "user-1");
    expect(permissions.requireOwnerOrCapability).toHaveBeenCalledWith("meeting-1", "user-1", "captions.manage");
    expect(featureFlags.isEnabledForMeeting).toHaveBeenCalledWith("LIVE_CAPTIONS", "meeting-1");
    expect(liveKit.startCaptions).toHaveBeenCalledWith(MEETING.livekitRoomName);
    expect(broadcast.publish).toHaveBeenCalledWith("meeting-1", WS_EVENTS.CAPTIONS_STARTED, {});
    expect(result).toEqual({ active: true });
  });

  it("start() logs a real MeetingEvent — the one durable record AdminAnalyticsService's feature-engagement stats read", async () => {
    const { service, prisma } = makeService();
    await service.start("meeting-1", "user-1");
    expect(prisma.client.meetingEvent.create).toHaveBeenCalledWith({
      data: { meetingId: "meeting-1", userId: "user-1", type: "CAPTIONS_STARTED" },
    });
  });

  it("start() refuses to dispatch when the LIVE_CAPTIONS flag is off for this meeting", async () => {
    const { service, liveKit, prisma } = makeService({ liveCaptionsEnabled: false });
    await expect(service.start("meeting-1", "user-1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(liveKit.startCaptions).not.toHaveBeenCalled();
    expect(prisma.client.meetingEvent.create).not.toHaveBeenCalled();
  });

  it("stop() requires captions.manage and clears any dispatch for the room", async () => {
    const { service, permissions, liveKit, broadcast } = makeService();
    const result = await service.stop("meeting-1", "user-1");
    expect(permissions.requireOwnerOrCapability).toHaveBeenCalledWith("meeting-1", "user-1", "captions.manage");
    expect(liveKit.stopCaptions).toHaveBeenCalledWith(MEETING.livekitRoomName);
    expect(broadcast.publish).toHaveBeenCalledWith("meeting-1", WS_EVENTS.CAPTIONS_STOPPED, {});
    expect(result).toEqual({ active: false });
  });

  it("status() only requires plain participancy, not the manage capability", async () => {
    const { service, permissions, liveKit } = makeService();
    const result = await service.status("meeting-1", "user-1");
    expect(permissions.getParticipant).toHaveBeenCalledWith("meeting-1", "user-1");
    expect(liveKit.captionsActive).toHaveBeenCalledWith(MEETING.livekitRoomName);
    expect(result).toEqual({ active: true });
  });
});
