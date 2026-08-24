import { MeetingsService } from "./meetings.service";
import { WS_EVENTS } from "@arutech/types";
import type { PrismaService } from "../prisma/prisma.service";
import type { LiveKitService } from "../livekit/livekit.service";
import type { PermissionService } from "./permission.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";

const MEETING = {
  id: "meeting-1",
  livekitRoomName: "room-1",
  deletedAt: null,
  settings: {},
};

function makeService() {
  const prisma = {
    client: {
      meeting: {
        findUnique: jest.fn().mockResolvedValue(MEETING),
        update: jest.fn().mockResolvedValue({ ...MEETING, status: "ENDED" }),
      },
    },
  } as unknown as PrismaService;
  const liveKit = { endRoom: jest.fn().mockResolvedValue(undefined) } as unknown as LiveKitService;
  const permissions = {
    requireOwnerOrCapability: jest.fn().mockResolvedValue(undefined),
  } as unknown as PermissionService;
  const broadcast = { publish: jest.fn().mockResolvedValue(undefined) } as unknown as RealtimeBroadcastService;

  const service = new MeetingsService(prisma, liveKit, permissions, broadcast);
  return { service, prisma, liveKit, permissions, broadcast };
}

describe("MeetingsService", () => {
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
});
