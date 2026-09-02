import type { SystemRole } from "@arutech/types";

/** Shape attached to `request.user` by JwtAuthGuard after verifying the access
 * token — OR, when `isGuest` is true, after verifying a meeting-scoped guest
 * token instead. A guest's `id` is their own MeetingParticipant.id, not a
 * User.id (no User row exists for them); `email`/`systemRole` are meaningless
 * placeholders that must never be trusted for anything (in particular,
 * `systemRole: "USER"` here does NOT mean "a real low-privilege account" —
 * every admin/systemRole-gated guard already only ever checks for `"ADMIN"`,
 * so this can't accidentally grant anything, but any new code reading
 * `request.user` on a route a guest could reach must check `isGuest` before
 * trusting `email`/`systemRole` at all). */
export interface AuthenticatedUser {
  id: string;
  email: string;
  systemRole: SystemRole;
  isGuest?: boolean;
  /** L-1: the Session row this specific access token was issued under —
   * present for a real user (absent for a guest, who has no Session row at
   * all). Lets a route distinguish "the device you're using right now" from
   * every other listed session, e.g. Settings' Active Sessions list marking
   * which one is "this device" and refusing to let it be revoked through
   * the same "sign out another device" control a real Sign Out button
   * already exists for. */
  sessionId?: string;
}
