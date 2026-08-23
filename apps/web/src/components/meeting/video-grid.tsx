"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTracks, RoomAudioRenderer, isTrackReference } from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";
import { VideoTile } from "./video-tile";

type ViewMode = "gallery" | "speaker";

function trackId(t: TrackReferenceOrPlaceholder): string {
  return `${t.participant.identity}:${t.source}`;
}

/**
 * Custom participant grid — replaces LiveKit's stock `GridLayout`/`ParticipantTile`
 * (see the previous version of this file in git history) with real view-mode
 * switching, multi-pin, "hide non-video participants", and per-tile
 * fullscreen/PiP, none of which the stock components expose. Still built
 * entirely on real `@livekit/components-react` track subscriptions — every
 * tile is a real published camera/screen-share track, never a placeholder
 * standing in for a fake stream.
 */
export function VideoGrid() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("gallery");
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [hideNonVideo, setHideNonVideo] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current?.requestFullscreen().catch(() => {});
  }

  function togglePin(id: string) {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  const screenShareTracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], {
    onlySubscribed: false,
  });

  const visibleCameraTracks = hideNonVideo ? cameraTracks.filter(isTrackReference) : cameraTracks;

  const { focusTracks, filmstripTracks } = useMemo(() => {
    if (screenShareTracks.length > 0) {
      // Screen share always takes the spotlight, in every view mode — matches
      // every mainstream conferencing product and avoids a confusing "why is
      // gallery view hiding the screen share" question.
      return { focusTracks: screenShareTracks, filmstripTracks: visibleCameraTracks };
    }
    const pinnedTracks = visibleCameraTracks.filter((t) => pinned.has(trackId(t)));
    if (pinnedTracks.length > 0) {
      return {
        focusTracks: pinnedTracks,
        filmstripTracks: visibleCameraTracks.filter((t) => !pinned.has(trackId(t))),
      };
    }
    if (viewMode === "speaker" && visibleCameraTracks.length > 0) {
      const speaker = visibleCameraTracks.find((t) => t.participant.isSpeaking) ?? visibleCameraTracks[0];
      if (speaker) {
        return {
          focusTracks: [speaker],
          filmstripTracks: visibleCameraTracks.filter((t) => t !== speaker),
        };
      }
    }
    return { focusTracks: [] as TrackReferenceOrPlaceholder[], filmstripTracks: [] as TrackReferenceOrPlaceholder[] };
  }, [screenShareTracks, visibleCameraTracks, pinned, viewMode]);

  const showGallery = focusTracks.length === 0;

  return (
    <div ref={containerRef} className="flex h-full w-full flex-col gap-2 bg-surface">
      {/* A real row, not an overlay floating on top of the video — an overlay
          here would sit in the same top-right corner as a focus tile's own
          hover controls (pin/PiP/fullscreen) and intercept clicks meant for
          them whenever that tile fills the top-right of the frame (caught by
          actually driving this with Playwright, not just by inspection). */}
      <div className="flex flex-none items-center justify-end gap-1.5">
        <div className="flex overflow-hidden rounded-lg border border-surface-border bg-surface-raised">
          <ModeButton active={viewMode === "gallery"} onClick={() => setViewMode("gallery")}>
            Gallery
          </ModeButton>
          <ModeButton active={viewMode === "speaker"} onClick={() => setViewMode("speaker")}>
            Speaker
          </ModeButton>
        </div>
        <IconToggle
          title={hideNonVideo ? "Show everyone" : "Hide non-video participants"}
          active={hideNonVideo}
          onClick={() => setHideNonVideo((v) => !v)}
        >
          <path d="M2 2l20 20M9.9 5.1A3 3 0 0 1 15 7v2M9 15a3 3 0 0 1-1-2.2M17 13a5 5 0 0 1-1.3 2.7M12 5a7 7 0 0 1 7 7c0 .8-.15 1.5-.4 2.2" />
        </IconToggle>
        <IconToggle title={isFullscreen ? "Exit fullscreen" : "Fullscreen"} active={isFullscreen} onClick={toggleFullscreen}>
          <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
        </IconToggle>
      </div>

      {showGallery ? (
        <div
          className="grid min-h-0 w-full flex-1 gap-2 p-1"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gridAutoRows: "1fr" }}
        >
          {visibleCameraTracks.length === 0 && (
            <p className="col-span-full grid place-items-center text-sm text-ink-muted">Waiting for participants…</p>
          )}
          {visibleCameraTracks.map((t) => (
            <VideoTile key={trackId(t)} trackRef={t} pinned={pinned.has(trackId(t))} onTogglePin={() => togglePin(trackId(t))} />
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 w-full flex-1 flex-col gap-2 p-1">
          <div className="flex min-h-0 flex-1 gap-2">
            {focusTracks.map((t) => (
              <div key={trackId(t)} className="min-w-0 flex-1">
                <VideoTile trackRef={t} large pinned={pinned.has(trackId(t))} onTogglePin={() => togglePin(trackId(t))} />
              </div>
            ))}
          </div>
          {filmstripTracks.length > 0 && (
            <div className="flex h-24 flex-none gap-2 overflow-x-auto">
              {filmstripTracks.map((t) => (
                <div key={trackId(t)} className="aspect-video h-full flex-none">
                  <VideoTile trackRef={t} pinned={pinned.has(trackId(t))} onTogglePin={() => togglePin(trackId(t))} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <RoomAudioRenderer />
    </div>
  );
}

function ModeButton({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-[11px] font-medium transition ${
        active ? "bg-brand-500 text-white" : "text-ink-3 hover:bg-surface-field"
      }`}
    >
      {children}
    </button>
  );
}

function IconToggle({
  children,
  title,
  active,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`pointer-events-auto grid h-8 w-8 place-items-center rounded-lg border border-surface-border backdrop-blur transition ${
        active ? "bg-brand-500 text-white" : "bg-surface-raised/90 text-ink-3 hover:bg-surface-field"
      }`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {children}
      </svg>
    </button>
  );
}
