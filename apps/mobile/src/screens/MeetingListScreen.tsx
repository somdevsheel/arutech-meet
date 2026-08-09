import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { apiFetch, ApiError } from '../lib/api-client';
import { useAuthStore } from '../lib/auth-store';
import { colors } from '../lib/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'MeetingList'>;

interface Meeting {
  id: string;
  code: string;
  title: string;
  type: string;
  status: string;
}

export function MeetingListScreen({ navigation }: Props) {
  const { user, clear } = useAuthStore();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Meeting[]>('/meetings');
      setMeetings(data);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function createInstantMeeting() {
    setCreating(true);
    setError(null);
    try {
      const meeting = await apiFetch<Meeting>('/meetings', {
        method: 'POST',
        body: JSON.stringify({ title: 'Instant Meeting', type: 'INSTANT' }),
      });
      navigation.navigate('PreJoin', { code: meeting.code });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create meeting');
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hi, {user?.displayName}</Text>
          <Text style={styles.username}>@{user?.username}</Text>
        </View>
        <Pressable onPress={clear}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <View style={styles.joinRow}>
        <TextInput
          style={styles.joinInput}
          placeholder="Enter meeting code"
          placeholderTextColor={colors.textMuted}
          value={joinCode}
          onChangeText={setJoinCode}
          autoCapitalize="none"
        />
        <Pressable
          style={styles.joinButton}
          disabled={!joinCode.trim()}
          onPress={() => navigation.navigate('PreJoin', { code: joinCode.trim() })}
        >
          <Text style={styles.joinButtonText}>Join</Text>
        </Pressable>
      </View>

      <Pressable style={styles.newMeetingButton} onPress={createInstantMeeting} disabled={creating}>
        {creating ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.newMeetingText}>+ New instant meeting</Text>
        )}
      </Pressable>

      {error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.sectionTitle}>Your meetings</Text>
      <FlatList
        data={meetings}
        keyExtractor={(m) => m.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.brand} />}
        ListEmptyComponent={
          !loading ? <Text style={styles.empty}>No meetings yet — start one above.</Text> : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.meetingRow}
            onPress={() => navigation.navigate('PreJoin', { code: item.code })}
          >
            <Text style={styles.meetingTitle}>{item.title}</Text>
            <Text style={styles.meetingMeta}>
              {item.code} · {item.type} · {item.status}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  greeting: { fontSize: 20, fontWeight: '600', color: colors.text },
  username: { fontSize: 13, color: colors.textMuted },
  signOut: { fontSize: 13, color: colors.textMuted },
  joinRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  joinInput: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    color: colors.text,
  },
  joinButton: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  joinButtonText: { color: colors.text, fontWeight: '600' },
  newMeetingButton: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 20,
  },
  newMeetingText: { color: '#fff', fontWeight: '600' },
  error: { color: colors.danger, marginBottom: 12, fontSize: 13 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  empty: { color: colors.textMuted, fontSize: 13 },
  meetingRow: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  meetingTitle: { color: colors.text, fontWeight: '600', fontSize: 15 },
  meetingMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
