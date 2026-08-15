import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalParticipant } from '@livekit/react-native';
import { colors } from '../../lib/theme';

interface Props {
  onToggleChat: () => void;
  onToggleParticipants: () => void;
  onLeave: () => void;
  chatOpen: boolean;
  participantsOpen: boolean;
}

/**
 * Mobile counterpart to apps/web's MeetingToolbar — same underlying LiveKit
 * local-participant API. Screen share is real on Android: `useLocalParticipant`
 * comes from `@livekit/components-react` (the same headless hooks web uses —
 * `@livekit/react-native` re-exports them, only the rendering is
 * platform-specific), so `setScreenShareEnabled` is the identical call web
 * makes. It works because `@livekit/react-native-webrtc`'s `registerGlobals()`
 * (see apps/mobile/index.js) wires a real `navigator.mediaDevices.getDisplayMedia`
 * backed by Android's MediaProjection API — see AndroidManifest.xml for the
 * foreground-service permissions that requires.
 *
 * iOS is a real platform gap, not an oversight: Apple requires screen capture
 * to run in a separate Broadcast Upload Extension target, which has to be
 * created in Xcode (a new target + entitlements + App Group), and Xcode only
 * runs on macOS — this was developed on Linux. Tracked in docs/roadmap.md and
 * apps/mobile/README.md rather than silently disabled.
 */
export function MeetingToolbar({
  onToggleChat,
  onToggleParticipants,
  onLeave,
  chatOpen,
  participantsOpen,
}: Props) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant();
  const [busy, setBusy] = useState(false);

  async function toggle(kind: 'mic' | 'cam' | 'screen') {
    setBusy(true);
    try {
      if (kind === 'mic') await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
      if (kind === 'cam') await localParticipant.setCameraEnabled(!isCameraEnabled);
      if (kind === 'screen') await localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.bar}>
      <ToolbarButton active={isMicrophoneEnabled} disabled={busy} onPress={() => toggle('mic')} label={isMicrophoneEnabled ? 'Mute' : 'Unmute'} />
      <ToolbarButton active={isCameraEnabled} disabled={busy} onPress={() => toggle('cam')} label={isCameraEnabled ? 'Stop video' : 'Start video'} />
      {Platform.OS === 'android' && (
        <ToolbarButton
          active={isScreenShareEnabled}
          disabled={busy}
          onPress={() => toggle('screen')}
          label={isScreenShareEnabled ? 'Stop share' : 'Share screen'}
        />
      )}
      <ToolbarButton active={participantsOpen} onPress={onToggleParticipants} label="People" />
      <ToolbarButton active={chatOpen} onPress={onToggleChat} label="Chat" />
      <Pressable onPress={onLeave} style={styles.leaveButton}>
        <Text style={styles.leaveText}>Leave</Text>
      </Pressable>
    </View>
  );
}

function ToolbarButton({
  active,
  onPress,
  label,
  disabled,
}: {
  active: boolean;
  onPress: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, active && styles.buttonActive]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  button: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8 },
  buttonActive: { backgroundColor: colors.border },
  buttonText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  leaveButton: { backgroundColor: '#dc2626', paddingVertical: 9, paddingHorizontal: 16, borderRadius: 8 },
  leaveText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
