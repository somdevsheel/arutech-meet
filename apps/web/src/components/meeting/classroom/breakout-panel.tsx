"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { WS_EVENTS } from "@arutech/types";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";

interface BreakoutRoom {
  id: string;
  name: string;
  assignments: { userId: string; user: { displayName: string } }[];
}

export function BreakoutPanel({
  meetingId,
  socket,
  canManage,
  onJoinRoom,
  onReturnToMain,
  inBreakoutRoom,
}: {
  meetingId: string;
  socket: Socket | null;
  canManage: boolean;
  onJoinRoom: (token: string, url: string, label: string) => void;
  onReturnToMain: () => void;
  inBreakoutRoom: boolean;
}) {
  const userId = useAuthStore((s) => s.user?.id);
  const [rooms, setRooms] = useState<BreakoutRoom[]>([]);
  const [count, setCount] = useState(2);
  const [assignedRoom, setAssignedRoom] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    apiFetch<BreakoutRoom[]>(`/meetings/${meetingId}/breakout-rooms`).then(setRooms);
  }, [meetingId]);

  useEffect(() => {
    if (!socket) return;
    const onCreated = (p: { rooms: { id: string; name: string }[] }) => {
      apiFetch<BreakoutRoom[]>(`/meetings/${meetingId}/breakout-rooms`).then(setRooms);
      void p;
    };
    const onAssigned = (p: { userId: string; breakoutRoomId: string; roomName: string }) => {
      if (p.userId === userId) setAssignedRoom({ id: p.breakoutRoomId, name: p.roomName });
    };
    const onClosed = () => {
      setRooms([]);
      setAssignedRoom(null);
      if (inBreakoutRoom) onReturnToMain();
    };
    socket.on(WS_EVENTS.BREAKOUT_ROOMS_CREATED, onCreated);
    socket.on(WS_EVENTS.BREAKOUT_ROOM_ASSIGNED, onAssigned);
    socket.on(WS_EVENTS.BREAKOUT_ROOMS_CLOSED, onClosed);
    return () => {
      socket.off(WS_EVENTS.BREAKOUT_ROOMS_CREATED, onCreated);
      socket.off(WS_EVENTS.BREAKOUT_ROOM_ASSIGNED, onAssigned);
      socket.off(WS_EVENTS.BREAKOUT_ROOMS_CLOSED, onClosed);
    };
  }, [socket, meetingId, userId, inBreakoutRoom, onReturnToMain]);

  async function createRooms() {
    setCreating(true);
    try {
      const names = Array.from({ length: count }, (_, i) => `Room ${i + 1}`);
      await apiFetch(`/meetings/${meetingId}/breakout-rooms`, {
        method: "POST",
        body: JSON.stringify({ names, autoAssign: true }),
      });
      const updated = await apiFetch<BreakoutRoom[]>(`/meetings/${meetingId}/breakout-rooms`);
      setRooms(updated);
    } finally {
      setCreating(false);
    }
  }

  async function joinRoom(roomId: string, label: string) {
    const { token, url } = await apiFetch<{ token: string; url: string }>(
      `/meetings/${meetingId}/breakout-rooms/${roomId}/token`,
      { method: "POST" },
    );
    onJoinRoom(token, url, label);
  }

  async function closeAll() {
    await apiFetch(`/meetings/${meetingId}/breakout-rooms/close-all`, { method: "POST" });
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {inBreakoutRoom && (
        <button
          onClick={onReturnToMain}
          className="rounded bg-amber-500/20 px-3 py-2 text-xs font-medium text-amber-300"
        >
          ← Return to main room
        </button>
      )}

      {assignedRoom && !inBreakoutRoom && (
        <div className="rounded-lg border border-brand-500 bg-brand-500/10 p-3">
          <p className="mb-2 text-xs text-slate-200">
            You&apos;ve been assigned to <strong>{assignedRoom.name}</strong>.
          </p>
          <button
            onClick={() => joinRoom(assignedRoom.id, assignedRoom.name)}
            className="rounded bg-brand-500 px-3 py-1.5 text-xs font-medium text-white"
          >
            Join breakout room
          </button>
        </div>
      )}

      {canManage && (
        <div className="space-y-2 rounded-lg border border-surface-border bg-surface-raised/50 p-3">
          <p className="text-xs font-medium uppercase text-slate-500">Create breakout rooms</p>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Number of rooms
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 1)}
              className="input w-16"
            />
          </label>
          <button
            onClick={createRooms}
            disabled={creating || rooms.length > 0}
            className="w-full rounded bg-brand-500 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {rooms.length > 0 ? "Rooms already open" : "Create & auto-assign"}
          </button>
          {rooms.length > 0 && (
            <button onClick={closeAll} className="w-full rounded bg-red-600 py-2 text-xs font-medium text-white">
              Close all rooms
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {rooms.map((room) => (
          <div key={room.id} className="rounded-lg border border-surface-border p-3">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-medium text-white">{room.name}</p>
              {canManage && (
                <button onClick={() => joinRoom(room.id, room.name)} className="text-xs text-brand-300">
                  Join
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {room.assignments.map((a) => a.user.displayName).join(", ") || "No one assigned"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
