/** "Last seen" phrasing for a user known to be OFFLINE (a real presence
 * status — see PresenceService / docs/roadmap.md's Presence stage) — never
 * guesses "Online" from recency, since real presence already answered that
 * question for certain. Use this whenever a real presence status is known,
 * even (especially) when that status is OFFLINE. */
export function formatLastSeenPhrase(lastSeenAtIso: string): string {
  const diffMs = Date.now() - new Date(lastSeenAtIso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Last seen just now";
  if (minutes < 60) return `Last seen ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Last seen ${days}d ago`;
  return `Last seen ${new Date(lastSeenAtIso).toLocaleDateString()}`;
}

const ONLINE_GUESS_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

/** Graceful-degradation fallback ONLY, for the window before any real
 * presence status has loaded yet (before the first `GET /presence` poll
 * resolves, or before a PRESENCE_UPDATED push has arrived) — a recency
 * guess at "online", since `User.lastSeenAt` is all that's available yet.
 *
 * Once a real presence status is known — including OFFLINE — callers should
 * use `formatLastSeenPhrase` instead, never this. Live verification of the
 * Presence stage caught a real bug from getting this wrong: a user who had
 * just gone offline (so `lastSeenAt` was freshly bumped by
 * RealtimeGateway.handleDisconnect) still read as "Online" here for up to
 * two more minutes, even though the real-time presence system already knew
 * for certain they weren't. See docs/roadmap.md. */
export function formatLastSeen(lastSeenAtIso: string): string {
  const diffMs = Date.now() - new Date(lastSeenAtIso).getTime();
  if (diffMs < ONLINE_GUESS_WINDOW_MS) return "Online";
  return formatLastSeenPhrase(lastSeenAtIso);
}
