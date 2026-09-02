"use client";

/**
 * H-8: every protected page waits on `useAuthStore`'s `hasHydrated` flag
 * before deciding whether to redirect to /login (see auth-store.ts's own
 * comment on why — bailing out before hydration finishes would otherwise
 * bounce a genuinely logged-in user on a plain page refresh), but the render
 * guard for that same waiting window used to be a bare `return null` —
 * nothing at all, just the page background, for however long hydration and
 * the initial client-side render actually take (measured 1.8-5.5s on a cold
 * hard navigation across 5 routes). A blank page reads as broken, not
 * loading. Every one of those guards now renders this instead.
 */
export function FullPageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  );
}
