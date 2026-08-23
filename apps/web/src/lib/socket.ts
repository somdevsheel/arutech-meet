import { io, type Socket } from "socket.io-client";
import { env } from "./env";

let socket: Socket | null = null;

/**
 * Lazily creates (or returns) the singleton app-level realtime socket,
 * authenticated with the current access token. Reconnects automatically;
 * callers should re-join their meeting room in a `connect` listener since
 * Socket.IO does not remember rooms across a reconnect.
 *
 * **Always returns the same object once created** (until `disconnectSocket`
 * is explicitly called on sign-out) — this matters more than it looks. An
 * earlier version recreated the socket (`.disconnect()` + a fresh `io()`)
 * any time it was called while the existing one was still mid-connect (not
 * yet `.connected`), which killed the in-flight connection and silently
 * orphaned every listener a hook had already attached to it in a closure
 * (`useCallSocket`, `useNotifications`, etc. — anything that calls
 * `getSocket()` once inside a `useEffect` and holds the result). In practice
 * this fired constantly in dev under React StrictMode's double-effect-invoke,
 * and would just as easily fire in production after any real reconnect that
 * raced a second `getSocket()` call. Found by live-testing calls: the server
 * genuinely delivered `call:incoming` (confirmed via a raw WebSocket frame
 * capture) but the client's own store never saw it, because the listener was
 * registered on a socket object that had already been discarded. Socket.IO's
 * client already reconnects the *same* object on its own — this function no
 * longer needs to (or should) manage that itself.
 */
export function getSocket(accessToken: string): Socket {
  if (!socket) {
    socket = io(env.wsUrl, {
      auth: { token: accessToken },
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    return socket;
  }

  // Keep the auth payload current so the *next* reconnect (e.g. after an
  // access-token refresh) authenticates with the latest token — updating
  // `.auth` doesn't affect an already-established connection.
  socket.auth = { token: accessToken };
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
