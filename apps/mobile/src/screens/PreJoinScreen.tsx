import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { apiFetch, ApiError } from '../lib/api-client';
import { useAuthStore } from '../lib/auth-store';
import { colors } from '../lib/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PreJoin'>;

interface MeetingPreview {
  code: string;
  title: string;
  status: string;
  requiresPassword: boolean;
  waitingRoomEnabled: boolean;
}

interface JoinResponse {
  participantId: string;
  role: string;
  status: 'WAITING' | 'ADMITTED';
  meeting: { id: string; code: string; title: string; livekitRoomName: string };
  livekitUrl: string | null;
  livekitToken: string | null;
}

/**
 * Camera/mic permission + join-options screen. Unlike the web client (which uses
 * LiveKit's <PreJoin> with a live local-camera preview before ever connecting),
 * @livekit/react-native's device APIs are built around an already-created Room —
 * there is no equivalent standalone preview widget here yet. This screen instead
 * requests OS permissions up front and lets the user pick starting mic/camera
 * state, then MeetingRoomScreen shows the real local video tile once connected.
 * Tracked as a follow-up in docs/roadmap.md, not silently glossed over.
 */
export function PreJoinScreen({ route, navigation }: Props) {
  const { code } = route.params;
  const { user, accessToken } = useAuthStore();

  const [preview, setPreview] = useState<MeetingPreview | null>(null);
  const [password, setPassword] = useState('');
  const [guestName, setGuestName] = useState('');
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [permissionsGranted, setPermissionsGranted] = useState(Platform.OS !== 'android');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<MeetingPreview>(`/meetings/${code}`, { skipAuth: !accessToken })
      .then(setPreview)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Meeting not found'));
  }, [code, accessToken]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]).then((result) => {
      setPermissionsGranted(
        result[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED &&
          result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED,
      );
    });
  }, []);

  async function join() {
    setJoining(true);
    setError(null);
    try {
      const path = user ? `/meetings/${code}/join` : `/meetings/${code}/join-as-guest`;
      const result = await apiFetch<JoinResponse>(path, {
        method: 'POST',
        body: JSON.stringify({
          password: password || undefined,
          guestName: user ? undefined : guestName || 'Guest',
        }),
        skipAuth: !user,
      });

      if (result.status === 'WAITING' || !result.livekitToken || !result.livekitUrl) {
        setError('The host has a waiting room enabled — mobile does not yet support the live wait screen (see apps/web for that flow). Ask the host to disable the waiting room or admit you, then retry.');
        return;
      }

      navigation.replace('MeetingRoom', {
        meetingId: result.meeting.id,
        meetingCode: result.meeting.code,
        title: result.meeting.title,
        token: result.livekitToken,
        livekitUrl: result.livekitUrl,
        participantId: result.participantId,
        role: result.role,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to join meeting');
    } finally {
      setJoining(false);
    }
  }

  if (!preview && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{preview?.title ?? code}</Text>

      {!permissionsGranted && (
        <Text style={styles.warning}>Camera/microphone permission is required to join with video.</Text>
      )}

      {!user && (
        <>
          <Text style={styles.label}>Your name</Text>
          <TextInput
            style={styles.input}
            value={guestName}
            onChangeText={setGuestName}
            placeholder="Guest"
            placeholderTextColor={colors.textMuted}
          />
        </>
      )}

      {preview?.requiresPassword && (
        <>
          <Text style={styles.label}>Meeting password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholderTextColor={colors.textMuted}
          />
        </>
      )}

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Join with microphone</Text>
        <Switch value={micEnabled} onValueChange={setMicEnabled} />
      </View>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Join with camera</Text>
        <Switch value={cameraEnabled} onValueChange={setCameraEnabled} />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.button} onPress={join} disabled={joining}>
        {joining ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Join meeting</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 24, justifyContent: 'center' },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '600', color: colors.text, marginBottom: 20 },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 6, marginTop: 12 },
  warning: { color: colors.warning, fontSize: 13, marginBottom: 12 },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  toggleLabel: { color: colors.text, fontSize: 14 },
  error: { color: colors.danger, marginTop: 16, fontSize: 13 },
  button: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 28,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
