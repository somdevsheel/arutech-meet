import { WS_EVENTS } from "@arutech/types";
import { NotificationsService } from "./notifications.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";

function makeService() {
  const prisma = {
    client: {
      notification: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: "notif-1" }),
      },
    },
  } as unknown as PrismaService;
  const broadcast = { publishToRoom: jest.fn().mockResolvedValue(undefined) } as unknown as RealtimeBroadcastService;

  const service = new NotificationsService(prisma, broadcast);
  return { service, prisma, broadcast };
}

// H-12: opening a Team Chat room already correctly cleared its CHAT_MESSAGE
// notifications server-side — the bug was that no open client ever learned
// about it, so the topbar bell's cached unread count stayed stale until a
// full reload. This is the fix: a live push alongside the DB write, using
// the exact same fan-out mechanism NOTIFICATION_CREATED already relies on.
describe("NotificationsService.markChatRoomNotificationsRead", () => {
  it("clears the room's CHAT_MESSAGE notifications in the DB", async () => {
    const { service, prisma } = makeService();
    await service.markChatRoomNotificationsRead("user-1", "room-1");
    expect(prisma.client.notification.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        type: "CHAT_MESSAGE",
        readAt: null,
        data: { path: ["chatRoomId"], equals: "room-1" },
      },
      data: { readAt: expect.any(Date) },
    });
  });

  it("pushes a live NOTIFICATION_CHAT_ROOM_READ event to the user's own personal room", async () => {
    const { service, broadcast } = makeService();
    await service.markChatRoomNotificationsRead("user-1", "room-1");
    expect(broadcast.publishToRoom).toHaveBeenCalledWith(
      "user:user-1",
      WS_EVENTS.NOTIFICATION_CHAT_ROOM_READ,
      { chatRoomId: "room-1" },
    );
  });
});
