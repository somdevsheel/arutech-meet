"use client";

import { useEffect, useState } from "react";
import type { Room } from "livekit-client";

/** Real feature gap reported directly: "there is no option to switch camera
 * within meetings" — the toolbar's camera button only ever toggled on/off,
 * with no way to pick WHICH camera on a machine with more than one (a
 * built-in webcam plus a USB one, a phone with front/back cameras, etc).
 * `Room.switchActiveDevice` (livekit-client) swaps the underlying track on
 * the already-published camera publication in place — no republish, no
 * renegotiation, and it keeps whatever virtual-background processor is
 * currently attached (see use-virtual-background.ts) since that's layered
 * on top of the track, not tied to a specific physical device. */
export function CameraSelectPanel({ room, onClose }: { room: Room; onClose: () => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | undefined>(undefined);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Labels only come through once camera permission has actually been
    // granted (otherwise every device reports an empty label) — always true
    // here, since this panel only opens from inside an already-joined
    // meeting where the camera has already been requested at least once.
    navigator.mediaDevices
      .enumerateDevices()
      .then((all) => {
        if (cancelled) return;
        setDevices(all.filter((d) => d.kind === "videoinput"));
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't list cameras on this device.");
      });
    setActiveDeviceId(room.getActiveDevice("videoinput"));
    return () => {
      cancelled = true;
    };
  }, [room]);

  async function selectDevice(deviceId: string) {
    if (deviceId === activeDeviceId) return;
    setSwitchingTo(deviceId);
    setError(null);
    try {
      await room.switchActiveDevice("videoinput", deviceId);
      setActiveDeviceId(deviceId);
    } catch {
      setError("Couldn't switch to that camera.");
    } finally {
      setSwitchingTo(null);
    }
  }

  return (
    <div className="w-64 rounded-xl border border-surface-border bg-surface-raised p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-2">Camera</span>
        <button onClick={onClose} className="text-ink-muted2 hover:text-white" aria-label="Close">
          ✕
        </button>
      </div>

      {devices === null ? (
        <p className="px-1 py-2 text-xs text-ink-muted">Looking for cameras…</p>
      ) : devices.length === 0 ? (
        <p className="px-1 py-2 text-xs text-ink-muted">No cameras found on this device.</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {devices.map((d, i) => {
            const isActive = d.deviceId === activeDeviceId;
            return (
              <button
                key={d.deviceId || i}
                onClick={() => selectDevice(d.deviceId)}
                disabled={switchingTo !== null}
                className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition disabled:opacity-50 ${
                  isActive ? "bg-brand-500/15 text-brand-300" : "text-ink-2 hover:bg-surface-elevated"
                }`}
              >
                <span className="truncate">{d.label || `Camera ${i + 1}`}</span>
                {switchingTo === d.deviceId ? (
                  <span className="flex-none text-[10px] text-ink-muted">Switching…</span>
                ) : (
                  isActive && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-none">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )
                )}
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
    </div>
  );
}
