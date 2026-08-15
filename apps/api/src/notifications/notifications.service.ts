import { Injectable } from "@nestjs/common";
import type { Prisma, NotificationType, NotificationChannel } from "@arutech/database";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeBroadcastService } from "../realtime/realtime-broadcast.service";
import { WS_EVENTS } from "@arutech/types";

/**
 * Thin, shared home for the `Notification` model — RecordingsEventsService
 * already wrote rows here (RECORDING_READY) with no UI ever reading them back;
 * this is what surfaces them (and any other notification type) to the topbar
 * bell, plus a real-time push over the same Socket.IO gateway everything else
 * uses so a badge count updates live instead of only on next page load.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly broadcast: RealtimeBroadcastService,
  ) {}

  list(userId: string, take = 30) {
    return this.prisma.client.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  unreadCount(userId: string) {
    return this.prisma.client.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, notificationId: string) {
    await this.prisma.client.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    await this.prisma.client.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /** Called when a chat room is opened (ChatService.markRoomRead) so the
   * sidebar's notification-driven unread badge and the room list's own
   * read-receipt-driven badge stay consistent — without this, reading a
   * room's messages wouldn't clear the CHAT_MESSAGE notifications that led
   * you there, leaving a stale badge count. */
  async markChatRoomNotificationsRead(userId: string, chatRoomId: string) {
    await this.prisma.client.notification.updateMany({
      where: {
        userId,
        type: "CHAT_MESSAGE",
        readAt: null,
        data: { path: ["chatRoomId"], equals: chatRoomId },
      },
      data: { readAt: new Date() },
    });
  }

  /** Every notification in the app should be created through here (not a raw
   * prisma.notification.create) so the real-time push is never forgotten. */
  async create(params: {
    userId: string;
    type: NotificationType;
    channel?: NotificationChannel;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }) {
    const notification = await this.prisma.client.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        channel: params.channel ?? "IN_APP",
        title: params.title,
        body: params.body,
        data: params.data as Prisma.InputJsonValue | undefined,
      },
    });
    // publishToRoom (not publish — that one only works for meeting rooms, see
    // its doc comment) — `user:{id}` is a room every authenticated socket
    // already joins on connect (see RealtimeGateway.handleConnection).
    await this.broadcast.publishToRoom(`user:${params.userId}`, WS_EVENTS.NOTIFICATION_CREATED, notification);
    return notification;
  }
}
