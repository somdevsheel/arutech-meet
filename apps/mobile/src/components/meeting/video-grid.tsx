import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Track } from 'livekit-client';
import {
  useTracks,
  isTrackReference,
  VideoTrack,
  type TrackReferenceOrPlaceholder,
} from '@livekit/react-native';
import { colors } from '../../lib/theme';

/**
 * Real track subscription/rendering via LiveKit's React Native SDK — same
 * `useTracks` hook and TrackReference model as the web client's video-grid
 * (apps/web/src/components/meeting/video-grid.tsx), just laid out with RN's
 * flexbox instead of the web `GridLayout` helper (which isn't published for
 * React Native — only the DOM/web components package ships it).
 */
export function VideoGrid() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const columns = tracks.length <= 1 ? 1 : 2;

  return (
    <View style={styles.grid}>
      {tracks.map((trackRef) => (
        <VideoTile key={getTrackKey(trackRef)} trackRef={trackRef} widthPercent={100 / columns} />
      ))}
    </View>
  );
}

function getTrackKey(trackRef: TrackReferenceOrPlaceholder): string {
  return `${trackRef.participant.identity}-${trackRef.source}`;
}

function VideoTile({
  trackRef,
  widthPercent,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  widthPercent: number;
}) {
  // `withPlaceholder: true` means useTracks() also returns an entry for
  // participants with no published camera track (publication is undefined) so
  // the tile still shows a name card instead of vanishing — isTrackReference()
  // is the SDK's own way to narrow that union down to a track that actually
  // has media to render.
  const renderable = isTrackReference(trackRef);
  return (
    <View style={[styles.tile, { width: `${widthPercent}%` as `${number}%` }]}>
      {renderable ? (
        <VideoTrack trackRef={trackRef} style={styles.video} objectFit="cover" />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderText}>
            {trackRef.participant.name || trackRef.participant.identity}
          </Text>
        </View>
      )}
      <Text style={styles.nameTag} numberOfLines={1}>
        {trackRef.participant.name || trackRef.participant.identity}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  tile: {
    aspectRatio: 3 / 4,
    padding: 2,
  },
  video: { flex: 1, borderRadius: 8, overflow: 'hidden' },
  placeholder: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: { color: colors.textMuted, fontSize: 13 },
  nameTag: {
    position: 'absolute',
    bottom: 8,
    left: 10,
    color: '#fff',
    fontSize: 11,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
