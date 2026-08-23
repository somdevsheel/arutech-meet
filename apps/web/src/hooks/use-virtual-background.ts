"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { Track, type LocalVideoTrack } from "livekit-client";
import { BackgroundProcessor, supportsBackgroundProcessors, type BackgroundProcessorWrapper } from "@livekit/track-processors";

export type BackgroundMode = "none" | "blur" | "image";

/**
 * Real virtual background — LiveKit's own first-party `@livekit/track-processors`
 * package (MediaPipe selfie segmentation running via WebGL/WASM, the same
 * technique mainstream video platforms use), plugged into the actual published
 * local camera track via `LocalVideoTrack.setProcessor()`. Not a fake overlay:
 * the segmented/composited frame is what every other participant actually
 * receives, verifiable in your own tile exactly like anyone else's.
 *
 * One processor instance is created lazily and reused via `switchTo()` (the
 * package's documented pattern) rather than constructing a new processor per
 * selection — avoids the brief visual glitch a full teardown/rebuild causes
 * and keeps the (comparatively expensive) segmenter model loaded once per
 * session instead of per toggle.
 */
export function useVirtualBackground() {
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  const processorRef = useRef<BackgroundProcessorWrapper | null>(null);
  const [mode, setMode] = useState<BackgroundMode>("none");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported] = useState(() => {
    try {
      return supportsBackgroundProcessors();
    } catch {
      return false;
    }
  });

  function getCameraTrack(): LocalVideoTrack | undefined {
    return localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
  }

  async function ensureProcessor(track: LocalVideoTrack): Promise<BackgroundProcessorWrapper> {
    if (!processorRef.current) {
      processorRef.current = BackgroundProcessor({ mode: "disabled" });
      await track.setProcessor(processorRef.current);
    }
    return processorRef.current;
  }

  const applyNone = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const track = getCameraTrack();
      if (track?.getProcessor()) await track.stopProcessor();
      processorRef.current = null;
      setMode("none");
      setImagePath(null);
    } catch {
      setError("Couldn't remove the background effect");
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getCameraTrack reads localParticipant fresh on every call; it isn't itself state
  }, [localParticipant]);

  const applyBlur = useCallback(
    async (blurRadius = 15) => {
      const track = getCameraTrack();
      if (!track) {
        setError("Turn on your camera first");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const processor = await ensureProcessor(track);
        await processor.switchTo({ mode: "background-blur", blurRadius });
        setMode("blur");
        setImagePath(null);
      } catch {
        setError("Couldn't apply background blur — your browser may not support it");
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getCameraTrack reads localParticipant fresh on every call; it isn't itself state
    [localParticipant],
  );

  const applyImage = useCallback(
    async (path: string) => {
      const track = getCameraTrack();
      if (!track) {
        setError("Turn on your camera first");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const processor = await ensureProcessor(track);
        await processor.switchTo({ mode: "virtual-background", imagePath: path });
        setMode("image");
        setImagePath(path);
      } catch {
        setError("Couldn't load that image as a background");
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getCameraTrack reads localParticipant fresh on every call; it isn't itself state
    [localParticipant],
  );

  // If the camera gets turned off entirely, LiveKit tears down the underlying
  // track (and the processor with it) — reflect that back into UI state
  // rather than showing a mode that's silently no longer active.
  useEffect(() => {
    if (!isCameraEnabled) {
      processorRef.current = null;
      setMode("none");
    }
  }, [isCameraEnabled]);

  return { supported, mode, imagePath, busy, error, isCameraEnabled, applyNone, applyBlur, applyImage };
}
