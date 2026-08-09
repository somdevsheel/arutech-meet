import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer, DarkTheme, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { LoginScreen } from '../screens/LoginScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { MeetingListScreen } from '../screens/MeetingListScreen';
import { PreJoinScreen } from '../screens/PreJoinScreen';
import { MeetingRoomScreen } from '../screens/MeetingRoomScreen';
import { useAuthStore } from '../lib/auth-store';
import { colors } from '../lib/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surfaceRaised,
    border: colors.border,
    primary: colors.brand,
    text: colors.text,
  },
};

export function RootNavigator() {
  const { user, hydrated } = useAuthStore();

  if (!hydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <>
            <Stack.Screen name="MeetingList" component={MeetingListScreen} />
            <Stack.Screen name="PreJoin" component={PreJoinScreen} options={{ headerShown: true, title: 'Join meeting' }} />
            <Stack.Screen name="MeetingRoom" component={MeetingRoomScreen} options={{ gestureEnabled: false }} />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            {/* Guests can still join a meeting by code without an account, so the
                join flow stays reachable even while logged out. */}
            <Stack.Screen name="PreJoin" component={PreJoinScreen} options={{ headerShown: true, title: 'Join meeting' }} />
            <Stack.Screen name="MeetingRoom" component={MeetingRoomScreen} options={{ gestureEnabled: false }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
});
