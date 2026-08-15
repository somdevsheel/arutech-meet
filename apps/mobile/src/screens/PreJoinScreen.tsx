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
import { WS_EVENTS } from '@arutech/types';
import { createLocalVideoTrack, type LocalVideoTrack } from 'livekit-client';
import { VideoView } from '@livekit/react-native';
import type { RootStackParamList } from '../navigation/types';
import { apiFetch, ApiError } from '../lib/api-client';
import { useAuthStore } from '../lib/auth-store';
import { getSocket } from '../lib/socket';
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

type Phase = 'form' | 'joining' | 'waiting';

/**
 * Camera/mic permission + join-options screen. @livekit/react-native's own
 * components are built around an already-created Room (no <PreJoin>-equivalent
 * widget), but `livekit-client` — the same core package that powers it, and
 * already a direct dependency here for its `LocalVideoTrack` types — exposes
 * `createLocalVideoTrack()`, a plain getUserMedia-based capture with no Room
 * required. Combined with `@livekit/react-native`'s `VideoView` (which renders
 * any raw LocalVideoTrack, not just ones attached to a Room), that's enough to
 * build a real preview: this screen captures its own short-lived track while
 * the "Join with camera" toggle is on, and hands the camera back (stops the
 * track) right before MeetingRoomScreen's <LiveKitRoom> does its own capture.
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
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const [waitingFor, setWaitingFor] = useState<{ meetingId: string; participantId: string } | null>(null);
  const [previewTrack, setPreviewTrack] = useState<LocalVideoTrack | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

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

  // Live self-preview: capture a real camera track only while it'd actually be
  // shown (camera toggle on, permission granted, still on the form) and always
  // stop it on the way out — camera hardware is exclusive, so an unstopped
  // preview track would fight the Room's own capture in MeetingRoomScreen.
  useEffect(() => {
    if (!cameraEnabled || !permissionsGranted || phase !== 'form') return;
    let cancelled = false;
    let track: LocalVideoTrack | null = null;

    createLocalVideoTrack({ facingMode: 'user' })
      .then((t) => {
        if (cancelled) {
          t.stop();
          return;
        }
        track = t;
        setPreviewTrack(t);
        setPreviewError(null);
      })
      .catch((err) => {
        if (!cancelled) setPreviewError(err instanceof Error ? err.message : 'Camera preview failed');
      });

    return () => {
      cancelled = true;
      track?.stop();
      setPreviewTrack(null);
    };
  }, [cameraEnabled, permissionsGranted, phase]);

  // Live wait-for-admit: same socket-driven flow as apps/web/src/app/meeting/[code]/page.tsx
  // — join this meeting's realtime channel and listen for the host's admit decision
  // scoped to this specific participant, then exchange it for a real LiveKit token.
  // Only reachable when logged in: guests have no JWT to open the authenticated
  // WebSocket channel with (same limitation web has — see docs/realtime.md), so
  // they still get the informative fallback message below instead.
  useEffect(() => {
    if (phase !== 'waiting' || !accessToken || !waitingFor) return;
    const socket = getSocket(accessToken);
    socket.emit(WS_EVENTS.JOIN_MEETING, { meetingId: waitingFor.meetingId });

    const onAdmit = async (payload: { participantId: string }) => {
      if (payload.participantId !== waitingFor.participantId) return;
      try {
        const { token, url } = await apiFetch<{ token: string; url: string }>(
          `/meetings/${waitingFor.meetingId}/participants/${waitingFor.participantId}/token`,
          { method: 'POST' },
        );
        navigation.replace('MeetingRoom', {
          meetingId: waitingFor.meetingId,
          meetingCode: code,
          title: preview?.title ?? code,
          token,
          livekitUrl: url,
          participantId: waitingFor.participantId,
          role: 'GUEST',
        });
      } catch {
        // Stay on the waiting screen; the host can retry admitting.
      }
    };
    socket.on(WS_EVENTS.WAITING_ROOM_ADMIT, onAdmit);
    return () => {
      socket.off(WS_EVENTS.WAITING_ROOM_ADMIT, onAdmit);
    };
  }, [phase, accessToken, waitingFor, navigation, code, preview?.title]);

  async function join() {
    setPhase('joining');
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
        if (accessToken) {
          setWaitingFor({ meetingId: result.meeting.id, participantId: result.participantId });
          setPhase('waiting');
        } else {
          setError(
            'The host has a waiting room enabled. Guests on mobile cannot be live-admitted yet — sign in, or ask the host to disable the waiting room, then retry.',
          );
          setPhase('form');
        }
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
      setPhase('form');
    }
  }

  if (!preview && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (phase === 'waiting') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
        <Text style={styles.waitingText}>Waiting for the host to let you in…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{preview?.title ?? code}</Text>

      <View style={styles.preview}>
        {cameraEnabled && previewTrack ? (
          <VideoView videoTrack={previewTrack} style={styles.previewVideo} objectFit="cover" mirror />
        ) : (
          <View style={styles.previewPlaceholder}>
            <Text style={styles.previewPlaceholderText}>
              {!cameraEnabled ? 'Camera off' : previewError ?? 'Starting camera…'}
            </Text>
          </View>
        )}
      </View>

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

      <Pressable style={styles.button} onPress={join} disabled={phase === 'joining'}>
        {phase === 'joining' ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Join meeting</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 24, justifyContent: 'center' },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '600', color: colors.text, marginBottom: 20 },
  preview: {
    aspectRatio: 4 / 3,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewVideo: { flex: 1 },
  previewPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  previewPlaceholderText: { color: colors.textMuted, fontSize: 13 },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 6, marginTop: 12 },
  warning: { color: colors.warning, fontSize: 13, marginBottom: 12 },
  waitingText: { color: colors.textMuted, fontSize: 14, marginTop: 16 },
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
