"use client";

import { create } from "zustand";
import type { CallType } from "@arutech/types";
import { apiFetch, ApiError } from "./api-client";

export type CallPhase = "idle" | "outgoing" | "incoming" | "active";

export interface CallPeer {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

interface CallState {
  phase: CallPhase;
  callId: string | null;
  callType: CallType | null;
  peer: CallPeer | null;
  livekitRoomName: string | null;
  token: string | null;
  url: string | null;
  error: string | null;

  startCall: (peer: CallPeer, type: CallType) => Promise<void>;
  receiveIncoming: (callId: string, type: CallType, livekitRoomName: string, initiator: CallPeer) => void;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  cancelCall: () => void;
  endCall: () => void;
  onRemoteAccepted: (callId: string) => void;
  onRemoteEnded: (callId: string, reason: string) => void;
  clearError: () => void;
}

const IDLE = {
  phase: "idle" as const,
  callId: null,
  callType: null,
  peer: null,
  livekitRoomName: null,
  token: null,
  url: null,
  error: null,
};

/**
 * Global call state — one call at a time (no call-waiting UI in v1, see
 * docs/roadmap.md). Owns the REST calls into `apps/api/src/calls`; the
 * live incoming/accepted/rejected/ended signaling comes from
 * `useCallSocket`, which just calls `receiveIncoming`/`onRemoteAccepted`/
 * `onRemoteEnded` on this store — kept as two separate files (state vs.
 * socket wiring) the same way `useNotifications` and the topbar bell are
 * split, rather than binding socket listeners inside a Zustand store itself.
 */
// Exposed only outside production so an E2E test (or a developer in the
// console) can drive a call without a populated Contacts list in the way —
// e.g. `window.__callStore.getState().startCall(...)`. Not reachable in a
// production build; nothing here is sensitive even in dev (it's only ever
// the current user's own client-side call state).
declare global {
  interface Window {
    __callStore?: typeof useCallStore;
  }
}

export const useCallStore = create<CallState>((set, get) => ({
  ...IDLE,

  async startCall(peer, type) {
    set({ ...IDLE, phase: "outgoing", peer, callType: type });
    try {
      const result = await apiFetch<{ callId: string; token: string; url: string; livekitRoomName: string }>(
        "/calls",
        { method: "POST", body: JSON.stringify({ calleeUserIds: [peer.id], type }) },
      );
      // Still "outgoing" (ringing) here — only WS_EVENTS.CALL_ACCEPTED (via
      // onRemoteAccepted) moves this to "active".
      if (get().phase === "outgoing") {
        set({ callId: result.callId, token: result.token, url: result.url, livekitRoomName: result.livekitRoomName });
      }
    } catch (err) {
      set({ ...IDLE, error: err instanceof ApiError ? err.message : "Failed to start call" });
    }
  },

  receiveIncoming(callId, type, livekitRoomName, initiator) {
    // No call-waiting in v1 — a second incoming call while already on one is
    // silently missed (the caller's copy of this call still rings out and
    // marks itself MISSED server-side; see CallsService).
    if (get().phase !== "idle") return;
    set({ phase: "incoming", callId, callType: type, livekitRoomName, peer: initiator, error: null });
  },

  async acceptCall() {
    const { callId } = get();
    if (!callId) return;
    try {
      const result = await apiFetch<{ token: string; url: string; livekitRoomName: string }>(
        `/calls/${callId}/accept`,
        { method: "POST" },
      );
      set({ phase: "active", token: result.token, url: result.url, livekitRoomName: result.livekitRoomName });
    } catch (err) {
      set({ ...IDLE, error: err instanceof ApiError ? err.message : "Failed to accept call" });
    }
  },

  rejectCall() {
    const { callId } = get();
    if (callId) apiFetch(`/calls/${callId}/reject`, { method: "POST" }).catch(() => {});
    set(IDLE);
  },

  cancelCall() {
    const { callId } = get();
    if (callId) apiFetch(`/calls/${callId}/cancel`, { method: "POST" }).catch(() => {});
    set(IDLE);
  },

  endCall() {
    const { callId } = get();
    if (callId) apiFetch(`/calls/${callId}/end`, { method: "POST" }).catch(() => {});
    set(IDLE);
  },

  onRemoteAccepted(callId) {
    if (get().callId !== callId) return;
    set({ phase: "active" });
  },

  onRemoteEnded(callId, reason) {
    if (get().callId !== callId) return;
    set({
      ...IDLE,
      error: reason === "busy" ? "They're on another call" : reason === "declined" ? "Call declined" : null,
    });
  },

  clearError() {
    set({ error: null });
  },
}));

if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  window.__callStore = useCallStore;
}
