import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  systemRole: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  hydrated: boolean;
  setSession: (user: AuthUser, accessToken: string, refreshToken: string) => void;
  setAccessToken: (accessToken: string) => void;
  setHydrated: () => void;
  clear: () => void;
}

/**
 * Same session model as apps/web (see apps/web/src/lib/auth-store.ts) so both
 * clients behave identically against the API, backed by AsyncStorage instead of
 * localStorage. Same hardening note applies: the refresh token sits in
 * AsyncStorage (unencrypted) for this MVP — a follow-up should move it into
 * react-native-keychain / EncryptedSharedPreferences.
 *
 * `hydrated` exists because AsyncStorage reads are async: navigation must wait
 * for it before deciding whether to show the login screen or the app, otherwise
 * a logged-in user briefly flashes the login screen on every cold start.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      hydrated: false,
      setSession: (user, accessToken, refreshToken) => set({ user, accessToken, refreshToken }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setHydrated: () => set({ hydrated: true }),
      clear: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    {
      name: 'arutech-auth',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);
