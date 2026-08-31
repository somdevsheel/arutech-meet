"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Socket } from "socket.io-client";
import { WS_EVENTS } from "@arutech/types";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";

interface BreakoutRoom {
  id: string;
  name: string;
  assignments: { userId: string; user: { displayName: string } }[];
}

/** Scans a full room list (each with its `assignments`, as returned by
 * GET .../breakout-rooms) for the room the given user is assigned to, if
 * any. Used as the single source of truth for `assignedRoom` everywhere
 * `rooms` is set from a fresh fetch, rather than relying on catching every
 * individual event that could mean "you're now assigned" — which is
 * exactly the class of bug this fixes: BREAKOUT_ROOMS_CREATED's own
 * `assignments` payload (auto-assign) was previously read and discarded
 * here, so non-moderator participants had no Join affordance whatsoever
 * after a moderator's "Create & auto-assign" click. */
function findAssignedRoom(
  rooms: BreakoutRoom[],
  userId: string | undefined,
): { id: string; name: string } | null {
  if (!userId) return null;
  const room = rooms.find((r) => r.assignments.some((a) => a.userId === userId));
  return room ? { id: room.id, name: room.name } : null;
}

interface BreakoutContextValue {
  rooms: BreakoutRoom[];
  assignedRoom: { id: string; name: string } | null;
  count: number;
  setCount: (n: number) => void;
  creating: boolean;
  inBreakoutRoom: boolean;
  onReturnToMain: () => void;
  createRooms: () => Promise<void>;
  joinRoom: (roomId: string, label: string) => Promise<void>;
  closeAll: () => Promise<void>;
}

const BreakoutContext = createContext<BreakoutContextValue | null>(null);

/** Owns the breakout-rooms list, this user's own assignment, and the
 * socket listeners for all three breakout events — mounted once directly
 * in meeting-room.tsx, same as WhiteboardProvider/LocalRecordingProvider,
 * rather than only while the Breakout sub-tab of Tools happens to be the
 * visible one. That used to be the only place BREAKOUT_ROOMS_CLOSED was
 * ever caught: a participant who joined a breakout room and then closed
 * the side panel (or switched to Chat) to actually watch video — the
 * single most likely thing to be doing once inside a breakout room — never
 * ran onReturnToMain() when the host closed all rooms, and was left in a
 * dead LiveKit room with no way back except manually leaving and
 * rejoining the meeting from scratch. */
export function BreakoutProvider({
  meetingId,
  socket,
  onJoinRoom,
  onReturnToMain,
  inBreakoutRoom,
  children,
}: {
  meetingId: string;
  socket: Socket | null;
  onJoinRoom: (token: string, url: string, label: string) => void;
  onReturnToMain: () => void;
  inBreakoutRoom: boolean;
  children: ReactNode;
}) {
  const userId = useAuthStore((s) => s.user?.id);
  const [rooms, setRooms] = useState<BreakoutRoom[]>([]);
  const [count, setCount] = useState(2);
  const [assignedRoom, setAssignedRoom] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    // Also restores `assignedRoom` on mount/reload — a participant who was
    // auto-assigned, then reloaded the page, used to lose the "Join
    // breakout room" prompt entirely until the next live event, since it
    // was previously only ever set by catching an event, never derived
    // from the actual current state.
    apiFetch<BreakoutRoom[]>(`/meetings/${meetingId}/breakout-rooms`).then((data) => {
      setRooms(data);
      setAssignedRoom(findAssignedRoom(data, userId));
    });
  }, [meetingId, userId]);

  useEffect(() => {
    if (!socket) return;
    const onCreated = () => {
      // BREAKOUT_ROOMS_CREATED's own payload already carries `{ rooms,
      // assignments }` for exactly this — this re-fetch (rather than
      // reading the socket payload directly) is just to get each
      // assignment's displayName for the moderator's room list, which the
      // broadcast doesn't include. Either way, findAssignedRoom below is
      // what actually notices "was I one of the people auto-assigned".
      apiFetch<BreakoutRoom[]>(`/meetings/${meetingId}/breakout-rooms`).then((data) => {
        setRooms(data);
        setAssignedRoom(findAssignedRoom(data, userId));
      });
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
      setAssignedRoom(findAssignedRoom(updated, userId));
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

  const value: BreakoutContextValue = {
    rooms,
    assignedRoom,
    count,
    setCount,
    creating,
    inBreakoutRoom,
    onReturnToMain,
    createRooms,
    joinRoom,
    closeAll,
  };

  return <BreakoutContext.Provider value={value}>{children}</BreakoutContext.Provider>;
}

function useBreakout(): BreakoutContextValue {
  const ctx = useContext(BreakoutContext);
  if (!ctx) {
    throw new Error("BreakoutPanel must be rendered inside a BreakoutProvider");
  }
  return ctx;
}

/** Purely presentational — the room list, this user's assignment, and the
 * live socket listeners all come from context (BreakoutProvider above),
 * which stays mounted for the whole meeting regardless of which panel tab
 * is open. This component only renders while the Breakout tab itself is
 * open, so it must never own any of that state directly. */
export function BreakoutPanel({ canManage }: { canManage: boolean }) {
  const {
    rooms,
    assignedRoom,
    count,
    setCount,
    creating,
    inBreakoutRoom,
    onReturnToMain,
    createRooms,
    joinRoom,
    closeAll,
  } = useBreakout();

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
          <p className="mb-2 text-xs text-ink-2">
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
          <p className="text-xs font-medium uppercase text-ink-muted">Create breakout rooms</p>
          <label className="flex items-center gap-2 text-xs text-ink-muted">
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
            <button
              onClick={closeAll}
              className="w-full rounded bg-danger-strong py-2 text-xs font-medium text-white"
            >
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
                <button
                  onClick={() => joinRoom(room.id, room.name)}
                  className="text-xs text-brand-300"
                >
                  Join
                </button>
              )}
            </div>
            <p className="text-xs text-ink-muted">
              {room.assignments.map((a) => a.user.displayName).join(", ") || "No one assigned"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
