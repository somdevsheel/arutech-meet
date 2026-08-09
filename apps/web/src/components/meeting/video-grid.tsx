"use client";

import {
  GridLayout,
  ParticipantTile,
  useTracks,
  RoomAudioRenderer,
} from "@livekit/components-react";
import { Track } from "livekit-client";

/**
 * Renders every published camera + screen-share track via LiveKit's ParticipantTile
 * (active-speaker highlighting, mute indicators, etc. come from the SDK itself — this
 * is real track subscription/rendering, not a placeholder). RoomAudioRenderer plays
 * every remote audio track; without it participants would be silent.
 */
export function VideoGrid() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  return (
    <div className="h-full w-full">
      <GridLayout tracks={tracks} className="h-full">
        <ParticipantTile />
      </GridLayout>
      <RoomAudioRenderer />
    </div>
  );
}
