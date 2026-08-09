"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

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
      setSession: (user, accessToken, refreshToken) => set({ user, accessToken, refreshToken }),
      setAccessToken: (accessToken) => set({ accessToken }),
      clear: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    { name: "arutech-auth" },
  ),
);
