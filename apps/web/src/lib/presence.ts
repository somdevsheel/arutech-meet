import { useEffect } from "react";
import type { UserPresenceStatus } from "@arutech/types";
import { WS_EVENTS } from "@arutech/types";
import { getSocket } from "./socket";

/** Real presence (docs/roadmap.md's Presence stage) — shared status→label/dot
 * mapping so the account menu, Contacts, and Team Chat render the exact same
 * four colors for the exact same meaning. `OFFLINE` is never something a
 * client sets (see SETTABLE_PRESENCE_STATUSES) but is a real value `GET
 * /presence`/`PRESENCE_UPDATED` can return, so it's handled here too. */
export const PRESENCE_STATUS_META: Record<UserPresenceStatus, { label: string; dotClass: string }> = {
  ONLINE: { label: "Online", dotClass: "bg-success" },
  AWAY: { label: "Away", dotClass: "bg-warn" },
  BUSY: { label: "Busy", dotClass: "bg-danger" },
  DND: { label: "Do Not Disturb", dotClass: "bg-accent" },
  OFFLINE: { label: "Offline", dotClass: "bg-ink-muted2" },
};

const HEARTBEAT_INTERVAL_MS = 45_000;

/** Keeps this connection's presence TTL alive for as long as the app is
 * open — see PresenceService's class doc comment for why a heartbeat exists
 * at all beyond the socket connection itself (a crashed gateway process, not
 * just a crashed tab). Mounted once, in AppShell, so it runs on every
 * authenticated page. */
export function usePresenceHeartbeat(accessToken: string | null) {
  useEffect(() => {
    if (!accessToken) return;
    const socket = getSocket(accessToken);
    const interval = setInterval(() => socket.emit(WS_EVENTS.PRESENCE_HEARTBEAT), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [accessToken]);
}
