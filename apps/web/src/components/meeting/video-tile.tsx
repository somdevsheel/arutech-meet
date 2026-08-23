"use client";

import { useRef, useState } from "react";
import {
  VideoTrack,
  ConnectionQualityIndicator,
  TrackRefContext,
  isTrackReference,
} from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";

const AVATAR_COLORS = ["#3B6FE0", "#8E44AD", "#16A085", "#D35400", "#2C7A7B", "#C0392B", "#B8860B"];
function colorFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/**
 * One participant/screen-share tile. Replaces LiveKit's stock `ParticipantTile`
 * (see video-grid.tsx for why: pin/fullscreen/PiP need a ref to the underlying
 * `<video>` element and full control over layout, which the prebuilt component
 * doesn't expose). Still built entirely on `@livekit/components-react`
 * primitives (VideoTrack, ConnectionQualityIndicator) — real track rendering,
 * not a custom reimplementation of WebRTC playback.
 */
export function VideoTile({
  trackRef,
  pinned,
  onTogglePin,
  large,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  pinned: boolean;
  onTogglePin: () => void;
  large?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pipSupported] = useState(
    () => typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled,
  );
  // A disabled/never-published camera comes through as a placeholder (no
  // `publication`) rather than a muted publication — LiveKit unpublishes the
  // track entirely on `setCameraEnabled(false)` — so this alone is enough to
  // decide "render an avatar instead of a <video>".
  const hasVideo = isTrackReference(trackRef);
  const { participant } = trackRef;
  const isScreenShare = trackRef.source === Track.Source.ScreenShare;
  const label = participant.name || participant.identity;

  async function togglePip() {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement === videoRef.current) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch {
      // Browser refused (e.g. video not ready yet) — not fatal, just a no-op.
    }
  }

  function toggleTileFullscreen(e: React.MouseEvent) {
    e.stopPropagation();
    const el = e.currentTarget.closest("[data-video-tile]") as HTMLElement | null;
    if (!el) return;
    if (document.fullscreenElement === el) document.exitFullscreen();
    else el.requestFullscreen().catch(() => {});
  }

  return (
    <TrackRefContext.Provider value={trackRef}>
      <div
        data-video-tile
        className={`group relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-surface-raised ${
          pinned ? "ring-2 ring-brand-500" : ""
        }`}
      >
        {hasVideo ? (
          <VideoTrack
            ref={videoRef}
            trackRef={trackRef}
            className={`h-full w-full ${isScreenShare ? "object-contain bg-black" : "object-cover"}`}
          />
        ) : (
          <span
            className="grid place-items-center rounded-full font-semibold text-white"
            style={{
              background: colorFor(participant.identity),
              width: large ? 96 : 56,
              height: large ? 96 : 56,
              fontSize: large ? 32 : 18,
            }}
          >
            {label.slice(0, 2).toUpperCase()}
          </span>
        )}

        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2.5 py-2">
          {!participant.isMicrophoneEnabled && !isScreenShare && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <path d="M9 9V6a3 3 0 0 1 6 0v5M5 11a7 7 0 0 0 10.5 6M12 18v3M3 3l18 18" />
            </svg>
          )}
          <span className="truncate text-xs font-medium text-white">
            {label}
            {isScreenShare ? " · screen" : ""}
          </span>
        </div>

        <div className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-md bg-black/50 text-white">
          <ConnectionQualityIndicator />
        </div>

        <div className="absolute right-2 top-2 flex translate-x-0 gap-1 opacity-0 transition group-hover:opacity-100">
          <TileButton title={pinned ? "Unpin" : "Pin"} onClick={onTogglePin} active={pinned}>
            <path d="M12 2 9 9l-5 1 4 4-1 6 5-3 5 3-1-6 4-4-5-1-3-7Z" />
          </TileButton>
          {hasVideo && pipSupported && (
            <TileButton title="Picture-in-picture" onClick={togglePip}>
              <rect x="3" y="4" width="18" height="14" rx="2" />
              <rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
            </TileButton>
          )}
          <TileButton title="Fullscreen" onClick={toggleTileFullscreen}>
            <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
          </TileButton>
        </div>
      </div>
    </TrackRefContext.Provider>
  );
}

function TileButton({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-md backdrop-blur transition ${
        active ? "bg-brand-500 text-white" : "bg-black/50 text-white hover:bg-black/70"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {children}
      </svg>
    </button>
  );
}
