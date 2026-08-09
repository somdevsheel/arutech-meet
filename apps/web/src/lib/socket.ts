import { io, type Socket } from "socket.io-client";
import { env } from "./env";

let socket: Socket | null = null;

/** Lazily creates (or returns) the singleton app-level realtime socket, authenticated
 * with the current access token. Reconnects automatically; callers should re-join
 * their meeting room in a `connect` listener since Socket.IO does not remember
 * rooms across a reconnect. */
export function getSocket(accessToken: string): Socket {
  if (socket && socket.connected) return socket;
  if (socket) socket.disconnect();

  socket = io(env.wsUrl, {
    auth: { token: accessToken },
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
