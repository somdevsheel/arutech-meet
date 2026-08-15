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
    socket.on(WS_EVENTS.NOTIFICATION_CREATED, onCreated);
    return () => {
      socket.off(WS_EVENTS.NOTIFICATION_CREATED, onCreated);
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
