"use client";

import { useEffect } from "react";
import { WS_EVENTS } from "@arutech/types";
import type { CallIncomingPayload, CallAcceptedPayload, CallRejectedPayload, CallEndedPayload } from "@arutech/types";
import { getSocket } from "@/lib/socket";
import { useCallStore } from "@/lib/call-store";

/** Mounted once in AppShell (see components/calls/call-overlay.tsx) — listens
 * for incoming/accepted/rejected/ended call events on the shared app-level
 * socket (every authenticated socket auto-joins its own `user:{id}` room
 * server-side, see RealtimeGateway.handleConnection) and feeds them into
 * useCallStore, which owns the actual incoming/outgoing/active UI state. Kept
 * separate from the store itself the same way useNotifications is separate
 * from the topbar bell it feeds. */
export function useCallSocket(accessToken: string | null) {
  useEffect(() => {
    if (!accessToken) return;
    const socket = getSocket(accessToken);

    const onIncoming = (p: CallIncomingPayload) =>
      useCallStore.getState().receiveIncoming(p.callId, p.type, p.livekitRoomName, p.initiator);
    const onAccepted = (p: CallAcceptedPayload) => useCallStore.getState().onRemoteAccepted(p.callId);
    const onRejected = (p: CallRejectedPayload) =>
      useCallStore.getState().onRemoteEnded(p.callId, p.busy ? "busy" : "declined");
    const onEnded = (p: CallEndedPayload) => useCallStore.getState().onRemoteEnded(p.callId, p.reason);

    socket.on(WS_EVENTS.CALL_INCOMING, onIncoming);
    socket.on(WS_EVENTS.CALL_ACCEPTED, onAccepted);
    socket.on(WS_EVENTS.CALL_REJECTED, onRejected);
    socket.on(WS_EVENTS.CALL_ENDED, onEnded);
    return () => {
      socket.off(WS_EVENTS.CALL_INCOMING, onIncoming);
      socket.off(WS_EVENTS.CALL_ACCEPTED, onAccepted);
      socket.off(WS_EVENTS.CALL_REJECTED, onRejected);
      socket.off(WS_EVENTS.CALL_ENDED, onEnded);
    };
  }, [accessToken]);
}
