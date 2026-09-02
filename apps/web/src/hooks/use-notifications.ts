"use client";

import { useEffect, useState, useCallback } from "react";
import { WS_EVENTS } from "@arutech/types";
import { apiFetch } from "@/lib/api-client";
import { getSocket } from "@/lib/socket";

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

/** Backs the topbar bell — real data from GET /notifications (which
 * RecordingsEventsService and ContactsService.call both actually write to),
 * kept live via the same Socket.IO connection everything else uses (every
 * authenticated socket auto-joins a personal `user:{id}` room server-side —
 * see RealtimeGateway.handleConnection). */
export function useNotifications(accessToken: string | null) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    if (!accessToken) return;
    Promise.all([
      apiFetch<AppNotification[]>("/notifications"),
      apiFetch<number>("/notifications/unread-count"),
    ])
      .then(([list, count]) => {
        setNotifications(list);
        setUnreadCount(count);
      })
      .finally(() => setLoaded(true));
  }, [accessToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!accessToken) return;
    const socket = getSocket(accessToken);
    const onCreated = (notification: AppNotification) => {
      setNotifications((prev) => [notification, ...prev].slice(0, 30));
      setUnreadCount((c) => c + 1);
    };
    // H-12: opening a Team Chat room already marks its CHAT_MESSAGE
    // notifications read server-side, but this cached copy never learned
    // about it — the nav badge and bell dropdown stayed stale until a full
    // reload. Mirrors markRead below, just applied to every notification
    // for that room instead of one by id.
    const onChatRoomRead = ({ chatRoomId }: { chatRoomId: string }) => {
      // Derives clearedCount from `prev` inside this same updater (not from
      // the outer closure, which would be stale) and fires the unreadCount
      // update from there too — this is what keeps both counts correct
      // regardless of exactly when/how React schedules this update.
      setNotifications((prev) => {
        let clearedCount = 0;
        const next = prev.map((n) => {
          if (n.type !== "CHAT_MESSAGE" || n.readAt || (n.data as { chatRoomId?: string } | null)?.chatRoomId !== chatRoomId) {
            return n;
          }
          clearedCount += 1;
          return { ...n, readAt: new Date().toISOString() };
        });
        if (clearedCount > 0) setUnreadCount((c) => Math.max(0, c - clearedCount));
        return next;
      });
    };
    socket.on(WS_EVENTS.NOTIFICATION_CREATED, onCreated);
    socket.on(WS_EVENTS.NOTIFICATION_CHAT_ROOM_READ, onChatRoomRead);
    return () => {
      socket.off(WS_EVENTS.NOTIFICATION_CREATED, onCreated);
      socket.off(WS_EVENTS.NOTIFICATION_CHAT_ROOM_READ, onChatRoomRead);
    };
  }, [accessToken]);

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    await apiFetch(`/notifications/${id}/read`, { method: "POST" }).catch(() => {});
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    await apiFetch("/notifications/read-all", { method: "POST" }).catch(() => {});
  }

  return { notifications, unreadCount, loaded, markRead, markAllRead, refresh };
}
