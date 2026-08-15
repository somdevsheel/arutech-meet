"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { disconnectSocket } from "./socket";

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
  /** True once zustand's persist middleware has finished reading localStorage on
   * the client. Next.js SSRs this store with its initial (empty) state — the
   * persisted session is only applied after mount, asynchronously — so any page
   * that redirects unauthenticated users to /login MUST wait for this before
   * checking `accessToken`, or a plain page refresh on a protected route will
   * incorrectly bounce a genuinely logged-in user out. Set below via
   * `useAuthStore.persist.onFinishHydration`, not inside the store config
   * itself — referencing `useAuthStore` there is a TDZ error, since that
   * callback would run before the `const useAuthStore = ...` assignment below
   * completes. */
  hasHydrated: boolean;
  setSession: (user: AuthUser, accessToken: string, refreshToken: string) => void;
  setAccessToken: (accessToken: string) => void;
  clear: () => void;
}

/**
 * Client-side session store. Access/refresh tokens are persisted to localStorage for
 * this MVP; a follow-up hardening pass should move the refresh token to an HttpOnly
 * cookie set by the API (the API already accepts cookie-parser + COOKIE_SECRET for
 * this) so it is not readable by JS at all. Documented here rather than silently
 * treated as final — see docs/security.md.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      hasHydrated: false,
      setSession: (user, accessToken, refreshToken) => set({ user, accessToken, refreshToken }),
      setAccessToken: (accessToken) => set({ accessToken }),
      clear: () => {
        // The realtime socket (notifications, team chat) is an app-level
        // singleton that otherwise outlives any one page — see lib/socket.ts
        // and use-meeting-socket.ts. Sign-out is the one place it should
        // actually disconnect.
        disconnectSocket();
        set({ user: null, accessToken: null, refreshToken: null });
      },
    }),
    {
      name: "arutech-auth",
      // Don't persist this flag itself — it describes this tab's in-memory
      // hydration progress, not session data, and would otherwise round-trip
      // back as `false` on every fresh load before being corrected below.
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    },
  ),
);

// This module also evaluates during Next.js's server-side render of "use
// client" pages, where there's no localStorage to hydrate from and zustand's
// persist API isn't attached the same way — none of this applies there, and
// the SSR pass rendering with the untouched `hasHydrated: false` initial
// state is exactly what avoids a hydration mismatch once the client takes over.
if (typeof window !== "undefined") {
  useAuthStore.persist.onFinishHydration(() => useAuthStore.setState({ hasHydrated: true }));
  // Hydration may have already finished by the time this module evaluates (e.g.
  // fast synchronous storage) — onFinishHydration only fires for hydrations
  // that happen *after* it's registered, so cover that case explicitly too.
  if (useAuthStore.persist.hasHydrated()) {
    useAuthStore.setState({ hasHydrated: true });
  }
}
