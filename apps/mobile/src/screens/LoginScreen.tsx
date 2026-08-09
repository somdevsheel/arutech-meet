import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { loginSchema } from '@arutech/validation';
import type { RootStackParamList } from '../navigation/types';
import { apiFetch, ApiError } from '../lib/api-client';
import { useAuthStore, type AuthUser } from '../lib/auth-store';
import { colors } from '../lib/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch<{ user: AuthUser; accessToken: string; refreshToken: string }>(
        '/auth/login',
        { method: 'POST', body: JSON.stringify(parsed.data), skipAuth: true },
      );
      setSession(res.user, res.accessToken, res.refreshToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>Sign in</Text>

      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholderTextColor={colors.textMuted}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={styles.button} onPress={onSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
      </Pressable>

      <Pressable onPress={() => navigation.navigate('Register')}>
        <Text style={styles.link}>Don't have an account? Create one</Text>
      </Pressable>

      <GuestJoinRow navigation={navigation} />
    </KeyboardAvoidingView>
  );
}

function GuestJoinRow({ navigation }: { navigation: Props['navigation'] }) {
  const [code, setCode] = useState('');
  return (
    <View style={styles.guestRow}>
      <TextInput
        style={[styles.input, styles.guestInput]}
        value={code}
        onChangeText={setCode}
        placeholder="Or join with a meeting code"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
      />
      <Pressable
        style={styles.guestButton}
        disabled={!code.trim()}
        onPress={() => navigation.navigate('PreJoin', { code: code.trim() })}
      >
        <Text style={styles.guestButtonText}>Join</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 24, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '600', color: colors.text, marginBottom: 24 },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 6, marginTop: 12 },
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
  error: { color: colors.danger, marginTop: 12, fontSize: 13 },
  button: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  link: { color: colors.brandLight, textAlign: 'center', marginTop: 18, fontSize: 13 },
  guestRow: { flexDirection: 'row', gap: 8, marginTop: 28 },
  guestInput: { flex: 1, marginTop: 0 },
  guestButton: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  guestButtonText: { color: colors.text, fontWeight: '600', fontSize: 13 },
});
