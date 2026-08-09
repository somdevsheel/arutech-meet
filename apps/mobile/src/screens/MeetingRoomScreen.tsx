import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LiveKitRoom } from '@livekit/react-native';
import type { RootStackParamList } from '../navigation/types';
import { VideoGrid } from '../components/meeting/video-grid';
import { MeetingToolbar } from '../components/meeting/meeting-toolbar';
import { ChatSheet } from '../components/meeting/chat-sheet';
import { ParticipantsSheet } from '../components/meeting/participants-sheet';
import { useMeetingSocket } from '../hooks/use-meeting-socket';
import { useAuthStore } from '../lib/auth-store';
import { colors } from '../lib/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'MeetingRoom'>;

/**
 * Mirrors apps/web/src/components/meeting/meeting-room.tsx: a real LiveKit
 * connection (audio/video actually flowing through the SFU, not simulated) plus
 * the same Socket.IO-backed chat/presence/moderation channel. `connect` is
 * always true here — PreJoinScreen already resolved WAITING vs ADMITTED and
 * only navigates here once a livekitToken exists.
 */
export function MeetingRoomScreen({ route, navigation }: Props) {
  const { meetingId, meetingCode, title, token, livekitUrl, participantId } = route.params;
  const accessToken = useAuthStore((s) => s.accessToken);
  const [chatOpen, setChatOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);

  const { participants, messages, lastModeration, meetingEnded, sendMessage } = useMeetingSocket(
    meetingId,
    accessToken,
  );

  function leave() {
    navigation.replace('MeetingList');
  }

  if (meetingEnded) {
    return <EndedScreen text="This meeting has ended." onLeave={leave} />;
  }
  if (lastModeration?.type === 'remove' && lastModeration.participantId === participantId) {
    return <EndedScreen text="The host removed you from this meeting." onLeave={leave} />;
  }

  return (
    <LiveKitRoom
      serverUrl={livekitUrl}
      token={token}
      connect
      audio
      video
      onDisconnected={leave}
      onError={(err) => console.warn('[MeetingRoom] LiveKit error', err)}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.code}>{meetingCode}</Text>
        </View>

        <VideoGrid />

        <MeetingToolbar
          chatOpen={chatOpen}
          participantsOpen={participantsOpen}
          onToggleChat={() => setChatOpen((v) => !v)}
          onToggleParticipants={() => setParticipantsOpen((v) => !v)}
          onLeave={leave}
        />
      </View>

      <ChatSheet
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={messages}
        onSend={sendMessage}
      />
      <ParticipantsSheet
        visible={participantsOpen}
        onClose={() => setParticipantsOpen(false)}
        participants={participants}
      />
    </LiveKitRoom>
  );
}

function EndedScreen({ text, onLeave }: { text: string; onLeave: () => void }) {
  return (
    <View style={styles.ended}>
      <Text style={styles.endedText}>{text}</Text>
      <Text style={styles.endedLink} onPress={onLeave}>
        Back to meetings
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  code: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  ended: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  endedText: { color: colors.text, fontSize: 16, textAlign: 'center' },
  endedLink: { color: colors.brandLight, fontSize: 14, marginTop: 8 },
});
