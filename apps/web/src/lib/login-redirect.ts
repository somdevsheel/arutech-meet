/**
 * M-9: every protected page's auth guard bounced a signed-out visitor to a
 * bare `/login`, discarding whatever page they were actually trying to
 * reach — a notification linking straight to `/chat?room=<id>`, a shared
 * meeting link, a bookmarked settings page, all of it. LoginPage already
 * knew how to redirect back to `searchParams.get("redirect")` after
 * signing in (see its own `router.push`) — nothing ever populated it.
 *
 * `pathname` should come from `usePathname()` (safe for static rendering,
 * unlike `useSearchParams()`); the query string is read directly off
 * `window.location` instead of through `useSearchParams()` specifically to
 * avoid opting every one of these pages out of static rendering, which
 * would require wrapping each in its own <Suspense> boundary just for this
 * — a plain runtime read is enough since this only ever runs client-side,
 * inside a `hasHydrated` effect gate.
 */
export function loginRedirectUrl(pathname: string): string {
  const search = typeof window !== "undefined" ? window.location.search : "";
  return `/login?redirect=${encodeURIComponent(pathname + search)}`;
}
