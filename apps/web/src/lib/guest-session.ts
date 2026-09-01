/**
 * A meeting guest's auth state. Deliberately split across two very different
 * lifetimes:
 *
 * - The guest TOKEN (a short-lived, meeting-scoped JWT — see the API's
 *   TokenService.GuestTokenPayload) lives in memory only, for exactly this
 *   tab's lifetime. It's freshly re-minted by the server on every
 *   join-as-guest call, so there's nothing worth persisting — a reload just
 *   asks for a new one.
 * - The guest's own MeetingParticipant.id is what actually needs to survive
 *   a reload: it's how the server recognizes "the same guest" coming back
 *   (see joinMeetingSchema.guestParticipantId's doc comment) rather than
 *   creating a brand-new WAITING row every time — the only way a denied/
 *   removed guest can ever actually be told so on a rejoin. sessionStorage
 *   (not localStorage) on purpose: it's scoped to this one tab, matching a
 *   guest identity that was never meant to follow you to a new tab or a
 *   returning visit days later.
 */

let guestToken: string | null = null;
let guestTokenMeetingId: string | null = null;

/** Called once a join-as-guest response comes back with a token. */
export function setGuestSession(token: string, meetingId: string): void {
  guestToken = token;
  guestTokenMeetingId = meetingId;
}

/**
 * Returns the current guest token, if any. `apiFetch`/the meeting socket
 * fall back to this only when there's no real access token — a signed-in
 * user always wins even if a stale guest token happens to still be in
 * memory (e.g. leftover from an earlier guest visit this same tab).
 */
export function getGuestToken(): string | null {
  return guestToken;
}

export function getGuestTokenMeetingId(): string | null {
  return guestTokenMeetingId;
}

export function clearGuestSession(): void {
  guestToken = null;
  guestTokenMeetingId = null;
}

function storageKey(meetingCode: string): string {
  return `arutech-guest-participant:${meetingCode}`;
}

/** `sessionStorage` can throw (private-browsing/blocked-storage) or simply
 * not have anything stored — both are fine to treat as "no remembered
 * guest", not an error worth surfacing. */
export function getStoredGuestParticipantId(meetingCode: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(meetingCode));
  } catch {
    return null;
  }
}

export function storeGuestParticipantId(meetingCode: string, participantId: string): void {
  try {
    sessionStorage.setItem(storageKey(meetingCode), participantId);
  } catch {
    // Nothing to fall back to — worst case this guest isn't recognized on
    // their next reload and starts a fresh WAITING row, same as before.
  }
}
