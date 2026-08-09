import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
 * Mobile counterpart to apps/web's MeetingToolbar — same underlying
 * LiveKit local-participant API (setMicrophoneEnabled/setCameraEnabled), no
 * screen-share control here: RN screen sharing requires a platform broadcast
 * extension (ReplayKit on iOS, a MediaProjection foreground service on
 * Android) that isn't wired up in this pass — see docs/roadmap.md.
 */
export function MeetingToolbar({
  onToggleChat,
  onToggleParticipants,
  onLeave,
  chatOpen,
  participantsOpen,
}: Props) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const [busy, setBusy] = useState(false);

  async function toggle(kind: 'mic' | 'cam') {
    setBusy(true);
    try {
      if (kind === 'mic') await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
      if (kind === 'cam') await localParticipant.setCameraEnabled(!isCameraEnabled);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.bar}>
      <ToolbarButton active={isMicrophoneEnabled} disabled={busy} onPress={() => toggle('mic')} label={isMicrophoneEnabled ? 'Mute' : 'Unmute'} />
      <ToolbarButton active={isCameraEnabled} disabled={busy} onPress={() => toggle('cam')} label={isCameraEnabled ? 'Stop video' : 'Start video'} />
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
