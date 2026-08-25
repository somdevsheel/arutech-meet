import { WS_EVENTS } from "@arutech/types";
import { CaptionsService } from "./captions.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { LiveKitService } from "../livekit/livekit.service";
import type { PermissionService } from "../meetings/permission.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";

const MEETING = { livekitRoomName: "room-1", deletedAt: null };

function makeService() {
  const prisma = {
    client: { meeting: { findUnique: jest.fn().mockResolvedValue(MEETING) } },
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

  const service = new CaptionsService(prisma, liveKit, permissions, broadcast);
  return { service, prisma, liveKit, permissions, broadcast };
}

describe("CaptionsService", () => {
  it("start() requires captions.manage and dispatches the agent by room name", async () => {
    const { service, permissions, liveKit, broadcast } = makeService();
    const result = await service.start("meeting-1", "user-1");
    expect(permissions.requireOwnerOrCapability).toHaveBeenCalledWith("meeting-1", "user-1", "captions.manage");
    expect(liveKit.startCaptions).toHaveBeenCalledWith(MEETING.livekitRoomName);
    expect(broadcast.publish).toHaveBeenCalledWith("meeting-1", WS_EVENTS.CAPTIONS_STARTED, {});
    expect(result).toEqual({ active: true });
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
