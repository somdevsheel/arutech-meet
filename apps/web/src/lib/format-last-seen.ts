/** "Online status" v1 (see the schema comment on User.lastSeenAt) — a real
 * timestamp bumped on every WebSocket connect, not live presence. This
 * client-side judgment call (what counts as "online" vs. "last seen X ago")
 * intentionally lives here rather than on the server, which only ever sends
 * the raw timestamp. */
const ONLINE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

export function formatLastSeen(lastSeenAtIso: string): string {
  const lastSeenAt = new Date(lastSeenAtIso).getTime();
  const diffMs = Date.now() - lastSeenAt;
  if (diffMs < ONLINE_WINDOW_MS) return "Online";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `Last seen ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Last seen ${days}d ago`;
  return `Last seen ${new Date(lastSeenAtIso).toLocaleDateString()}`;
}

export function isOnline(lastSeenAtIso: string): boolean {
  return Date.now() - new Date(lastSeenAtIso).getTime() < ONLINE_WINDOW_MS;
}
